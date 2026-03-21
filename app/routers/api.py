"""API routes for room and media management."""

import os
import time
import uuid

import aiofiles
import httpx
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel

from app.config import MEDIA_DIR, MAX_UPLOAD_SIZE, GIPHY_API_KEY
from app.rooms import room_manager
from app.auth import get_current_user
from app.security import (
    ALLOWED_UPLOAD_EXTENSIONS,
    sanitize_text,
    validate_room_code,
    validate_video_url,
    validate_magic_bytes,
)

router = APIRouter(prefix="/api")


def _require_auth(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


# --------------- Rate limiter for room-code lookups ---------------

_JOIN_RATE: dict[str, float] = {}  # IP -> last request timestamp
_JOIN_INTERVAL = 2.0  # seconds between allowed requests


def _check_join_rate(request: Request):
    """Enforce 1 request per 2 seconds per IP on room-code lookups."""
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    last = _JOIN_RATE.get(ip, 0.0)
    if now - last < _JOIN_INTERVAL:
        wait = round(_JOIN_INTERVAL - (now - last), 1)
        raise HTTPException(429, f"Too many requests. Try again in {wait}s.")
    _JOIN_RATE[ip] = now


# --------------- Schemas ---------------

class CreateRoomRequest(BaseModel):
    name: str
    video_url: str = ""
    video_type: str = "url"  # "url" | "file"
    is_private: bool = False


class RoomResponse(BaseModel):
    code: str
    name: str
    viewers: int
    video_url: str
    video_type: str
    is_playing: bool
    current_time: float


# --------------- Room Endpoints ---------------

@router.post("/rooms", response_model=RoomResponse)
async def create_room(request: Request, body: CreateRoomRequest):
    _require_auth(request)
    name = sanitize_text(body.name, 20)
    if not name:
        raise HTTPException(400, "Room name is required")

    video_url = body.video_url.strip()
    video_type = body.video_type if body.video_type in ("url", "file") else "url"

    if video_url and video_type == "url":
        if not validate_video_url(video_url):
            raise HTTPException(400, "Invalid video URL. Only http/https URLs to video files are allowed.")

    room = room_manager.create_room(name, video_url, video_type, is_private=body.is_private)
    return RoomResponse(
        code=room.code,
        name=room.name,
        viewers=room.viewer_count,
        video_url=room.state.video_url,
        video_type=room.state.video_type,
        is_playing=room.state.is_playing,
        current_time=room.state.current_time,
    )


@router.get("/rooms")
async def list_rooms(request: Request):
    _require_auth(request)
    return room_manager.list_rooms()


@router.get("/rooms/{code}", response_model=RoomResponse)
async def get_room(request: Request, code: str):
    _require_auth(request)
    validated_code = validate_room_code(code)
    if not validated_code:
        raise HTTPException(400, "Invalid room code format")
    room = room_manager.get_room(validated_code)
    if not room:
        raise HTTPException(404, "Room not found")
    return RoomResponse(
        code=room.code,
        name=room.name,
        viewers=room.viewer_count,
        video_url=room.state.video_url,
        video_type=room.state.video_type,
        is_playing=room.state.is_playing,
        current_time=room.state.current_time,
    )


@router.get("/rooms/{code}/check")
async def check_room(request: Request, code: str):
    """Rate-limited room existence check used by the join form."""
    _require_auth(request)
    _check_join_rate(request)
    validated_code = validate_room_code(code)
    if not validated_code:
        raise HTTPException(400, "Invalid room code format")
    room = room_manager.get_room(validated_code)
    if not room:
        raise HTTPException(404, "Room not found")
    return {"code": room.code, "name": room.name}


# --------------- Giphy GIF Search Proxy ---------------


@router.get("/giphy/search")
async def giphy_search(request: Request, q: str = "", limit: int = 20):
    """Proxy Giphy GIF search so the API key stays server-side."""
    _require_auth(request)
    if not GIPHY_API_KEY:
        raise HTTPException(503, "GIF search is not configured")
    q = q.strip()[:100]
    if not q:
        raise HTTPException(400, "Missing search query")
    limit = max(1, min(limit, 30))
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            "https://api.giphy.com/v1/gifs/search",
            params={
                "q": q,
                "api_key": GIPHY_API_KEY,
                "limit": limit,
                "rating": "pg-13",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(502, "Giphy API error")
        data = resp.json()
    results = []
    for item in data.get("data", []):
        images = item.get("images", {})
        preview = images.get("fixed_width_small", {}).get("url", "")
        full = images.get("fixed_width", {}).get("url", "") or preview
        if preview and full:
            results.append({"preview": preview, "url": full})
    return {"results": results}


# --------------- Media Upload ---------------

@router.post("/upload")
async def upload_video(request: Request, room_code: str = Form(...), file: UploadFile = File(...)):
    _require_auth(request)

    validated_code = validate_room_code(room_code)
    if not validated_code:
        raise HTTPException(400, "Invalid room code format")
    room = room_manager.get_room(validated_code)
    if not room:
        raise HTTPException(404, "Room not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            400,
            f"File type '{ext}' not allowed. Accepted: {', '.join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}",
        )

    # Read first 64 KB and validate magic bytes match the extension
    first_chunk = await file.read(1024 * 64)
    if not validate_magic_bytes(first_chunk, ext):
        raise HTTPException(400, "File content does not match its extension. Upload a valid video file.")

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = MEDIA_DIR / safe_name
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    total_size = len(first_chunk)
    oversized = False
    async with aiofiles.open(dest, "wb") as out:
        await out.write(first_chunk)
        while chunk := await file.read(1024 * 1024):
            total_size += len(chunk)
            if total_size > MAX_UPLOAD_SIZE:
                oversized = True
                break
            await out.write(chunk)

    if oversized:
        dest.unlink(missing_ok=True)
        raise HTTPException(413, f"File too large. Maximum size is {MAX_UPLOAD_SIZE // (1024 ** 3)} GB.")

    video_url = f"/media/{safe_name}"
    room.state.video_url = video_url
    room.state.video_type = "file"
    room.state.is_playing = False
    room.state.current_time = 0.0

    return {"video_url": video_url, "filename": safe_name}

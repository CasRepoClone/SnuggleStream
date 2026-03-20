"""API routes for room and media management."""

import os
import uuid
from urllib.parse import urlparse

import aiofiles
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app.config import MEDIA_DIR, MAX_UPLOAD_SIZE
from app.rooms import room_manager
from app.auth import get_current_user

router = APIRouter(prefix="/api")


def _require_auth(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


# --------------- Schemas ---------------

class CreateRoomRequest(BaseModel):
    name: str
    video_url: str = ""
    video_type: str = "url"  # "url" | "file"


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
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Room name is required")
    if len(name) > 60:
        raise HTTPException(400, "Room name too long (max 60 chars)")

    video_url = body.video_url.strip()
    if video_url and body.video_type == "url":
        parsed = urlparse(video_url)
        if parsed.scheme not in ("http", "https"):
            raise HTTPException(400, "Only http/https URLs are allowed")

    room = room_manager.create_room(name, video_url, body.video_type)
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
    room = room_manager.get_room(code.upper())
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


# --------------- Media Upload ---------------

ALLOWED_EXTENSIONS = {".mp4", ".webm", ".mkv", ".avi", ".mov", ".m3u8"}


@router.post("/upload")
async def upload_video(request: Request, room_code: str = Form(...), file: UploadFile = File(...)):
    _require_auth(request)
    room = room_manager.get_room(room_code.upper())
    if not room:
        raise HTTPException(404, "Room not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type {ext} not allowed. Use: {', '.join(ALLOWED_EXTENSIONS)}")

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = MEDIA_DIR / safe_name
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    total_size = 0
    async with aiofiles.open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            total_size += len(chunk)
            if total_size > MAX_UPLOAD_SIZE:
                await out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "File too large. Max 2 GB.")
            await out.write(chunk)

    video_url = f"/media/{safe_name}"
    room.state.video_url = video_url
    room.state.video_type = "file"
    room.state.is_playing = False
    room.state.current_time = 0.0

    return {"video_url": video_url, "filename": safe_name}


@router.get("/media/{filename}")
async def serve_media(filename: str):
    safe = os.path.basename(filename)
    path = MEDIA_DIR / safe
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path)

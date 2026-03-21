"""Page-serving routes."""

import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.config import MEDIA_DIR, TEMPLATES_DIR
from app.auth import get_current_user
from app.security import validate_room_code

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    user = get_current_user(request)
    return templates.TemplateResponse("index.html", {"request": request, "user": user})


@router.get("/terms", response_class=HTMLResponse)
async def terms(request: Request):
    return templates.TemplateResponse("terms.html", {"request": request})


@router.get("/room/{code}", response_class=HTMLResponse)
async def room_page(request: Request, code: str):
    user = get_current_user(request)
    if not user:
        return RedirectResponse("/")
    validated_code = validate_room_code(code)
    if not validated_code:
        return RedirectResponse("/")
    return templates.TemplateResponse(
        "room.html",
        {"request": request, "room_code": validated_code, "user": user},
    )


@router.get("/media/{filename:path}")
async def serve_media(request: Request, filename: str):
    """Serve uploaded media files (including HLS segments) with auth + traversal protection."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(401, "Not authenticated")

    # Block path traversal components
    if ".." in filename or filename.startswith(("/", "\\")):
        raise HTTPException(400, "Invalid path")

    # Resolve and verify it stays inside MEDIA_DIR
    path = (MEDIA_DIR / filename).resolve()
    if not str(path).startswith(str(MEDIA_DIR.resolve())):
        raise HTTPException(400, "Invalid path")
    if not path.is_file():
        raise HTTPException(404, "File not found")

    # Correct MIME types for HLS files
    if filename.endswith(".m3u8"):
        return FileResponse(path, media_type="application/vnd.apple.mpegurl")
    if filename.endswith(".ts"):
        return FileResponse(path, media_type="video/MP2T")
    return FileResponse(path)

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
    if not user:
        return templates.TemplateResponse("login.html", {"request": request})
    return templates.TemplateResponse("index.html", {"request": request, "user": user})


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
    """Serve uploaded media files with authentication and path-traversal protection."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(401, "Not authenticated")
    safe = os.path.basename(filename)
    if not safe or safe.startswith("."):
        raise HTTPException(400, "Invalid filename")
    path = (MEDIA_DIR / safe).resolve()
    # Ensure resolved path is inside MEDIA_DIR (prevent traversal)
    if not str(path).startswith(str(MEDIA_DIR.resolve())):
        raise HTTPException(400, "Invalid path")
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path)

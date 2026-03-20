"""Page-serving routes."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.config import TEMPLATES_DIR

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@router.get("/room/{code}", response_class=HTMLResponse)
async def room_page(request: Request, code: str):
    return templates.TemplateResponse("room.html", {"request": request, "room_code": code.upper()})

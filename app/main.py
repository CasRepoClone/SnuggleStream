"""SnuggleStream — Synchronized video watching with friends."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import STATIC_DIR, MEDIA_DIR
from app.routers import api, ws, pages

app = FastAPI(title="SnuggleStream", version="1.0.0")

# Static files
STATIC_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")

# Routers
app.include_router(api.router)
app.include_router(ws.router)
app.include_router(pages.router)

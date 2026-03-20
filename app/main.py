"""SnuggleStream — Synchronized video watching with friends."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import STATIC_DIR, MEDIA_DIR, SESSION_SECRET
from app.routers import api, ws, pages, auth

app = FastAPI(title="SnuggleStream", version="1.0.0")

# Session middleware (signed cookies)
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, max_age=7 * 24 * 3600)

# Static files
STATIC_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")

# Routers
app.include_router(auth.router)
app.include_router(api.router)
app.include_router(ws.router)
app.include_router(pages.router)

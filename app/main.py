"""SnuggleStream — Synchronized video watching with friends."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import STATIC_DIR, MEDIA_DIR, SESSION_SECRET, BASE_URL
from app.routers import api, ws, pages, auth

# --------------- Security Headers Middleware ---------------

CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self' https://www.youtube.com https://s.ytimg.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' https: data:; "
    "media-src 'self' https: http:; "
    "connect-src 'self' ws: wss:; "
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com; "
    "object-src 'none'; "
    "base-uri 'self'"
)

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (b"content-security-policy", CSP_POLICY.encode()),
]


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(SECURITY_HEADERS)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


# --------------- App Setup ---------------

app = FastAPI(title="SnuggleStream", version="1.0.0")

# Middleware (outermost first)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    max_age=7 * 24 * 3600,
    https_only=BASE_URL.startswith("https://"),
)

# Static files (media served via authenticated endpoint in pages router)
STATIC_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Routers
app.include_router(auth.router)
app.include_router(api.router)
app.include_router(ws.router)
app.include_router(pages.router)

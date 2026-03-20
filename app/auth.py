"""Google OAuth2 authentication helpers."""

from authlib.integrations.starlette_client import OAuth
from starlette.requests import Request
from fastapi import HTTPException
from fastapi.responses import RedirectResponse

from app.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

oauth = OAuth()
oauth.register(
    name="google",
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def get_current_user(request: Request) -> dict | None:
    """Return user dict from session, or None if not logged in."""
    return request.session.get("user")


def require_user(request: Request) -> dict:
    """Return user dict or redirect to login."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401)
    return user

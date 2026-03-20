"""OAuth2 login/logout routes."""

import secrets

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from app.auth import oauth
from app.config import BASE_URL
from app.security import validate_image_url

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/login")
async def login(request: Request):
    redirect_uri = BASE_URL + "/auth/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/callback")
async def callback(request: Request):
    token = await oauth.google.authorize_access_token(request)
    userinfo = token.get("userinfo")
    if not userinfo:
        return RedirectResponse("/auth/login")

    # Rotate session: clear old data before setting new user
    request.session.clear()

    request.session["user"] = {
        "sub": str(userinfo.get("sub", ""))[:128],
        "name": str(userinfo.get("name", "User")).strip()[:100] or "User",
        "email": str(userinfo.get("email", "")).strip()[:254],
        "picture": validate_image_url(userinfo.get("picture", "")),
    }
    # Unique session identifier (rotated on each login)
    request.session["_sid"] = secrets.token_hex(16)

    return RedirectResponse("/")


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")

"""OAuth2 login/logout routes."""

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from app.auth import oauth
from app.config import BASE_URL

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

    request.session["user"] = {
        "sub": userinfo["sub"],
        "name": userinfo.get("name", "User"),
        "email": userinfo.get("email", ""),
        "picture": userinfo.get("picture", ""),
    }
    return RedirectResponse("/")


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")

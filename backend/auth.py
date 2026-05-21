"""Google OAuth + JWT session + refresh-token encryption."""
from __future__ import annotations

import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Cookie, Depends, HTTPException, Request
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from config import (
    fernet_key,
    google_oauth_client_id,
    google_oauth_client_secret,
    jwt_secret,
    public_base_url,
)
from db import get_db
from models import User

logger = logging.getLogger(__name__)

OAUTH_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.file",
]
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

SESSION_COOKIE_NAME = "thu_chi_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


# ── Crypto helpers ────────────────────────────────────────────────────────────

def _fernet() -> Fernet:
    key = fernet_key()
    if not key:
        raise RuntimeError("FERNET_KEY chưa được cấu hình.")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_refresh_token(refresh_token: str) -> str:
    return _fernet().encrypt(refresh_token.encode()).decode()


def decrypt_refresh_token(enc: str) -> str:
    try:
        return _fernet().decrypt(enc.encode()).decode()
    except InvalidToken as e:
        raise RuntimeError("Refresh token bị hỏng — yêu cầu user đăng nhập lại.") from e


# ── Session token (signed cookie) ────────────────────────────────────────────

def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(jwt_secret(), salt="thu-chi-session")


def make_session_token(user_id: int) -> str:
    return _serializer().dumps({"uid": user_id, "iat": int(time.time())})


def verify_session_token(token: str, max_age: int = SESSION_MAX_AGE) -> Optional[int]:
    try:
        payload = _serializer().loads(token, max_age=max_age)
        return int(payload.get("uid"))
    except BadSignature:
        return None
    except Exception:  # noqa: BLE001
        return None


# ── OAuth flow ───────────────────────────────────────────────────────────────

def build_redirect_uri() -> str:
    return f"{public_base_url()}/auth/callback"


def build_authorize_url(state: str) -> str:
    params = {
        "client_id": google_oauth_client_id(),
        "redirect_uri": build_redirect_uri(),
        "response_type": "code",
        "scope": " ".join(OAUTH_SCOPES),
        "access_type": "offline",
        "prompt": "consent",  # always show consent so we get refresh_token
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_code_for_tokens(code: str) -> dict:
    data = {
        "code": code,
        "client_id": google_oauth_client_id(),
        "client_secret": google_oauth_client_secret(),
        "redirect_uri": build_redirect_uri(),
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.post(GOOGLE_TOKEN_URL, data=data)
        r.raise_for_status()
        return r.json()


async def fetch_userinfo(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r.raise_for_status()
        return r.json()


async def refresh_access_token(refresh_token: str) -> dict:
    """Use a stored refresh_token to get a new access_token."""
    data = {
        "refresh_token": refresh_token,
        "client_id": google_oauth_client_id(),
        "client_secret": google_oauth_client_secret(),
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.post(GOOGLE_TOKEN_URL, data=data)
        if r.status_code != 200:
            logger.warning("Refresh failed: %s %s", r.status_code, r.text[:200])
            r.raise_for_status()
        return r.json()


# ── State token for CSRF ─────────────────────────────────────────────────────

def make_state() -> str:
    return secrets.token_urlsafe(24)


# ── FastAPI dependency: current user ─────────────────────────────────────────

def current_user_optional(
    session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> Optional[User]:
    if not session:
        return None
    uid = verify_session_token(session)
    if not uid:
        return None
    return db.get(User, uid)


def current_user_required(
    user: Optional[User] = Depends(current_user_optional),
) -> User:
    if user is None:
        raise HTTPException(401, "Cần đăng nhập")
    return user


# ── Per-user Google access token (cached + refreshed) ────────────────────────

_token_cache: dict[int, tuple[float, str]] = {}


async def access_token_for_user(user: User) -> str:
    """Return a valid access_token for this user; refresh if needed.

    Cache by user.id with TTL ≈ token_expiry - 60s.
    """
    if not user.refresh_token_enc:
        raise HTTPException(401, "User chưa có refresh token — đăng nhập lại với Google.")
    now = time.time()
    cached = _token_cache.get(user.id)
    if cached and cached[0] > now:
        return cached[1]
    refresh = decrypt_refresh_token(user.refresh_token_enc)
    payload = await refresh_access_token(refresh)
    access = payload["access_token"]
    expires = payload.get("expires_in", 3600)
    _token_cache[user.id] = (now + max(60, int(expires) - 60), access)
    return access

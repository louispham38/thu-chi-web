"""/auth/* and /api/me + onboarding routes."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
    access_token_for_user,
    build_authorize_url,
    current_user_required,
    encrypt_refresh_token,
    exchange_code_for_tokens,
    fetch_userinfo,
    make_session_token,
    make_state,
)
from config import (
    auth_enabled,
    google_oauth_client_id,
    google_picker_api_key,
    public_base_url,
)
from db import get_db
from models import Membership, User, Workspace
from user_sheet import create_workbook

logger = logging.getLogger(__name__)

router = APIRouter()

OAUTH_STATE_COOKIE = "thu_chi_oauth_state"


@router.get("/auth/status")
async def auth_status() -> dict:
    return {
        "enabled": auth_enabled(),
        "picker_enabled": bool(google_picker_api_key() and google_oauth_client_id()),
    }


@router.get("/api/auth/google-token")
async def google_token(user: User = Depends(current_user_required)) -> dict:
    """Return a fresh Google access_token + Picker config for this user.

    Used by the frontend to initialise Google Picker when adopting an existing
    Sheet. Only the user themselves can fetch their own token (cookie-gated).
    """
    if not (google_picker_api_key() and google_oauth_client_id()):
        raise HTTPException(503, "Google Picker chưa được cấu hình trên server.")
    access = await access_token_for_user(user)
    return {
        "access_token": access,
        "client_id": google_oauth_client_id(),
        "api_key": google_picker_api_key(),
    }


@router.get("/auth/login")
async def login(next: str = "/app") -> Response:
    if not auth_enabled():
        raise HTTPException(503, "OAuth chưa được cấu hình trên server.")
    state = make_state()
    url = build_authorize_url(state=f"{state}|{next}")
    resp = RedirectResponse(url, status_code=302)
    resp.set_cookie(
        OAUTH_STATE_COOKIE,
        state,
        max_age=600,
        httponly=True,
        secure=public_base_url().startswith("https://"),
        samesite="lax",
    )
    return resp


@router.get("/auth/callback")
async def callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    state_cookie: Optional[str] = Cookie(default=None, alias=OAUTH_STATE_COOKIE),
    db: Session = Depends(get_db),
) -> Response:
    if error:
        return RedirectResponse(f"/login?err={error}", status_code=302)
    if not code or not state:
        return RedirectResponse("/login?err=missing_code", status_code=302)
    if "|" not in state:
        return RedirectResponse("/login?err=bad_state", status_code=302)
    state_val, next_path = state.split("|", 1)
    if not state_cookie or state_cookie != state_val:
        return RedirectResponse("/login?err=state_mismatch", status_code=302)

    try:
        tokens = await exchange_code_for_tokens(code)
    except Exception as e:  # noqa: BLE001
        logger.exception("Token exchange failed")
        return RedirectResponse(f"/login?err=exchange_failed", status_code=302)

    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")  # may be None on subsequent logins
    if not access_token:
        return RedirectResponse("/login?err=no_access", status_code=302)

    info = await fetch_userinfo(access_token)
    sub = info.get("sub")
    email = info.get("email")
    if not sub or not email:
        return RedirectResponse("/login?err=no_user", status_code=302)

    user = db.query(User).filter(User.google_sub == sub).one_or_none()
    if user is None:
        user = User(
            google_sub=sub,
            email=email,
            name=info.get("name") or email.split("@")[0],
            picture=info.get("picture"),
            email_verified=bool(info.get("email_verified", True)),
        )
        db.add(user)
        db.flush()
    else:
        user.email = email
        user.name = info.get("name") or user.name
        user.picture = info.get("picture") or user.picture

    if refresh_token:
        user.refresh_token_enc = encrypt_refresh_token(refresh_token)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    token = make_session_token(user.id)
    resp = RedirectResponse(next_path or "/app", status_code=302)
    resp.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=public_base_url().startswith("https://"),
        samesite="lax",
    )
    resp.delete_cookie(OAUTH_STATE_COOKIE)
    return resp


@router.post("/auth/logout")
async def logout() -> Response:
    resp = Response(status_code=204)
    resp.delete_cookie(SESSION_COOKIE_NAME)
    return resp


@router.get("/api/me")
async def me(
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> dict:
    memberships = (
        db.query(Membership, Workspace)
        .join(Workspace, Membership.workspace_id == Workspace.id)
        .filter(Membership.user_id == user.id)
        .order_by(Membership.is_default.desc(), Membership.id.asc())
        .all()
    )
    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "picture": user.picture,
        },
        "workspaces": [
            {
                "id": w.id,
                "name": w.name,
                "sheet_id": w.sheet_id,
                "role": m.role,
                "is_default": m.is_default,
            }
            for (m, w) in memberships
        ],
    }


# ── Onboarding: create the user's first workspace + Sheet ────────────────────

class OnboardIn(BaseModel):
    workspace_name: str = "Thu/Chi của tôi"


@router.post("/api/onboarding/create-workspace")
async def onboarding_create(
    body: OnboardIn,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> dict:
    # If user already has a workspace, return it
    existing = (
        db.query(Membership, Workspace)
        .join(Workspace, Membership.workspace_id == Workspace.id)
        .filter(Membership.user_id == user.id, Membership.role == "owner")
        .first()
    )
    if existing:
        m, w = existing
        return {"id": w.id, "name": w.name, "sheet_id": w.sheet_id, "created": False}

    access = await access_token_for_user(user)
    sheet_id = await create_workbook(access, title=body.workspace_name)

    ws = Workspace(name=body.workspace_name, owner_id=user.id, sheet_id=sheet_id)
    db.add(ws)
    db.flush()
    mem = Membership(user_id=user.id, workspace_id=ws.id, role="owner", is_default=True)
    db.add(mem)
    db.commit()
    db.refresh(ws)
    return {"id": ws.id, "name": ws.name, "sheet_id": ws.sheet_id, "created": True}


class AdoptIn(BaseModel):
    workspace_name: str
    sheet_id: str


@router.post("/api/onboarding/adopt-sheet")
async def onboarding_adopt(
    body: AdoptIn,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> dict:
    """Use an existing Google Sheet (must be accessible by the user's OAuth token)."""
    sheet_id = body.sheet_id.strip()
    if not sheet_id:
        raise HTTPException(400, "sheet_id required")

    # Verify access by trying to open it. With drive.file scope, this only
    # succeeds if the user just picked the file via Google Picker (which
    # registers the file as "opened by app"). Manual paste of a Sheet ID
    # will fail here, which is the desired behaviour.
    access = await access_token_for_user(user)
    import gspread
    from google.oauth2.credentials import Credentials
    try:
        cli = gspread.authorize(Credentials(token=access))
        sh = cli.open_by_key(sheet_id)
        sh_title = sh.title
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            400,
            "Không truy cập được Sheet. Hãy mở lại Google Picker và chọn file "
            f"từ Drive thay vì dán ID. Chi tiết: {e}",
        ) from e

    ws = Workspace(name=body.workspace_name or sh_title, owner_id=user.id, sheet_id=sheet_id)
    db.add(ws)
    db.flush()
    mem = Membership(user_id=user.id, workspace_id=ws.id, role="owner", is_default=True)
    db.add(mem)
    db.commit()
    db.refresh(ws)
    return {"id": ws.id, "name": ws.name, "sheet_id": ws.sheet_id, "created": False}

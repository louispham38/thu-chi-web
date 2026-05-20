"""Tenant resolution: pick the right Sheet to operate on for each request.

- If the request has a valid session cookie → use that user's default workspace
  (or the one named in the X-Workspace-Id header).
- Else if env var GOOGLE_SPREADSHEET_ID is set → legacy single-tenant mode
  (the original owner / Bot Telegram setup).
- Else → 401.

The resolver returns a `TenantCtx` with everything callers need to read/write
the right Sheet, hiding the difference between modes.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from auth import access_token_for_user, current_user_optional
from config import auth_enabled, credentials_path, spreadsheet_id
from db import get_db
from models import Membership, User, Workspace


@dataclass
class TenantCtx:
    mode: str  # "user" or "legacy"
    sheet_id: str
    # For "user" mode:
    access_token: Optional[str] = None
    workspace: Optional[Workspace] = None
    user: Optional[User] = None
    # For "legacy" mode:
    legacy_creds_path: Optional[str] = None


async def resolve_tenant(
    user: Optional[User] = Depends(current_user_optional),
    workspace_id: Optional[int] = Header(default=None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
) -> TenantCtx:
    if user is not None:
        # Multi-tenant mode
        ws: Optional[Workspace] = None
        if workspace_id:
            mem = (
                db.query(Membership)
                .filter(Membership.user_id == user.id, Membership.workspace_id == workspace_id)
                .first()
            )
            if not mem:
                raise HTTPException(404, "Không tìm thấy workspace hoặc bạn không phải thành viên")
            ws = db.get(Workspace, workspace_id)
        else:
            mem = (
                db.query(Membership)
                .filter(Membership.user_id == user.id)
                .order_by(Membership.is_default.desc(), Membership.id.asc())
                .first()
            )
            if mem:
                ws = db.get(Workspace, mem.workspace_id)
        if ws is None:
            raise HTTPException(412, "Bạn chưa có workspace — hãy hoàn tất onboarding.")
        token = await access_token_for_user(user)
        return TenantCtx(mode="user", sheet_id=ws.sheet_id, access_token=token, workspace=ws, user=user)

    # If OAuth is configured but user has no session → require login (don't leak legacy data)
    if auth_enabled():
        raise HTTPException(401, "Cần đăng nhập")

    # Legacy fallback (single-tenant deployment without OAuth)
    try:
        sid = spreadsheet_id()
    except RuntimeError:
        raise HTTPException(401, "Cần đăng nhập") from None
    creds = credentials_path()
    if not os.path.isfile(creds):
        raise HTTPException(503, f"Không tìm thấy credentials legacy: {creds}")
    return TenantCtx(mode="legacy", sheet_id=sid, legacy_creds_path=creds)

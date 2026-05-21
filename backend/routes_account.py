"""Phase 2 — workspace settings, invites, profile."""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from auth import access_token_for_user, current_user_required
from config import public_base_url
from db import get_db
from models import Invite, Membership, User, Workspace

logger = logging.getLogger(__name__)

router = APIRouter()

INVITE_TTL_DAYS = 7
ROLE_VALUES = ("owner", "editor", "viewer")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _membership_or_404(db: Session, user_id: int, workspace_id: int) -> Membership:
    m = (
        db.query(Membership)
        .filter(Membership.user_id == user_id, Membership.workspace_id == workspace_id)
        .first()
    )
    if not m:
        raise HTTPException(404, "Không tìm thấy workspace hoặc bạn không phải thành viên.")
    return m


def _require_role(member: Membership, *roles: str) -> None:
    if member.role not in roles:
        raise HTTPException(403, f"Cần quyền {' hoặc '.join(roles)}.")


async def _share_sheet(owner_token: str, sheet_id: str, email: str, role: str) -> None:
    """Grant Drive permission on the spreadsheet to `email`."""
    drive_role = "writer" if role in ("owner", "editor") else "reader"
    url = f"https://www.googleapis.com/drive/v3/files/{sheet_id}/permissions"
    payload = {"role": drive_role, "type": "user", "emailAddress": email}
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.post(
            url,
            params={"sendNotificationEmail": "true"},
            headers={"Authorization": f"Bearer {owner_token}"},
            json=payload,
        )
        if r.status_code >= 400:
            logger.warning("Drive share failed: %s %s", r.status_code, r.text[:200])
            r.raise_for_status()


# ─────────────────── Workspaces ───────────────────


class WorkspaceOut(BaseModel):
    id: int
    name: str
    sheet_id: str
    role: str
    is_default: bool


@router.get("/api/workspaces", response_model=list[WorkspaceOut])
async def list_workspaces(
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> list[WorkspaceOut]:
    rows = (
        db.query(Membership, Workspace)
        .join(Workspace, Membership.workspace_id == Workspace.id)
        .filter(Membership.user_id == user.id)
        .order_by(Membership.is_default.desc(), Membership.id.asc())
        .all()
    )
    return [
        WorkspaceOut(
            id=w.id, name=w.name, sheet_id=w.sheet_id,
            role=m.role, is_default=m.is_default,
        )
        for (m, w) in rows
    ]


class WorkspaceUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


@router.patch("/api/workspaces/{ws_id}")
async def rename_workspace(
    ws_id: int,
    body: WorkspaceUpdate,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> dict:
    m = _membership_or_404(db, user.id, ws_id)
    _require_role(m, "owner")
    ws = db.get(Workspace, ws_id)
    if ws is None:
        raise HTTPException(404)
    ws.name = body.name.strip()
    db.commit()
    return {"id": ws.id, "name": ws.name}


@router.delete("/api/workspaces/{ws_id}", status_code=204)
async def delete_workspace(
    ws_id: int,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
):
    m = _membership_or_404(db, user.id, ws_id)
    _require_role(m, "owner")
    # Don't touch the actual Google Sheet — let the owner keep it in Drive.
    ws = db.get(Workspace, ws_id)
    if ws is not None:
        db.delete(ws)
        db.commit()
    return


@router.post("/api/workspaces/{ws_id}/reconnect")
async def reconnect_workspace(
    ws_id: int,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> dict:
    """Re-validate that the user can read/write the workspace's Sheet.

    Frontend calls this after the user has just (re-)picked the file via
    Google Picker. The Picker flow tells Google "this user opened this file
    via my app", which grants `drive.file` scope access for it. This endpoint
    confirms via gspread that we can actually open the sheet now — useful
    when migrating from the old `spreadsheets` (sensitive) scope to the
    `drive.file`-only setup.
    """
    m = _membership_or_404(db, user.id, ws_id)
    _require_role(m, "owner", "editor")
    ws = db.get(Workspace, ws_id)
    if ws is None:
        raise HTTPException(404, "Workspace không tồn tại.")

    import gspread
    from google.oauth2.credentials import Credentials

    access = await access_token_for_user(user)
    try:
        cli = gspread.authorize(Credentials(token=access))
        sh = cli.open_by_key(ws.sheet_id)
        title = sh.title
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            400,
            "Chưa truy cập được sheet. Hãy chọn lại file từ Drive (Google Picker) "
            f"để cấp quyền cho ứng dụng. Chi tiết: {e}",
        ) from e
    return {"id": ws.id, "name": ws.name, "sheet_id": ws.sheet_id, "title": title}


@router.post("/api/workspaces/{ws_id}/leave", status_code=204)
async def leave_workspace(
    ws_id: int,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
):
    m = _membership_or_404(db, user.id, ws_id)
    if m.role == "owner":
        raise HTTPException(400, "Owner không thể rời workspace — hãy chuyển quyền hoặc xoá workspace.")
    db.delete(m)
    db.commit()
    return


# ─────────────────── Members ───────────────────


class MemberOut(BaseModel):
    user_id: int
    email: str
    name: Optional[str]
    picture: Optional[str]
    role: str
    is_default: bool


@router.get("/api/workspaces/{ws_id}/members", response_model=list[MemberOut])
async def list_members(
    ws_id: int,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> list[MemberOut]:
    _membership_or_404(db, user.id, ws_id)  # require membership
    rows = (
        db.query(Membership, User)
        .join(User, Membership.user_id == User.id)
        .filter(Membership.workspace_id == ws_id)
        .order_by(Membership.id.asc())
        .all()
    )
    return [
        MemberOut(
            user_id=u.id, email=u.email, name=u.name, picture=u.picture,
            role=m.role, is_default=m.is_default,
        )
        for (m, u) in rows
    ]


@router.delete("/api/workspaces/{ws_id}/members/{member_user_id}", status_code=204)
async def remove_member(
    ws_id: int,
    member_user_id: int,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
):
    me = _membership_or_404(db, user.id, ws_id)
    _require_role(me, "owner")
    if member_user_id == user.id:
        raise HTTPException(400, "Owner không thể tự xoá. Dùng 'Xoá workspace' để xoá toàn bộ.")
    target = (
        db.query(Membership)
        .filter(Membership.workspace_id == ws_id, Membership.user_id == member_user_id)
        .first()
    )
    if not target:
        raise HTTPException(404)
    db.delete(target)
    db.commit()
    return


# ─────────────────── Invites ───────────────────


class InviteCreate(BaseModel):
    email: EmailStr
    role: Literal["editor", "viewer"] = "editor"


class InviteOut(BaseModel):
    id: int
    email: str
    role: str
    token: str
    invite_url: str
    invited_by: str
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime]


def _invite_to_out(inv: Invite, inviter_name: str) -> InviteOut:
    return InviteOut(
        id=inv.id,
        email=inv.email,
        role=inv.role,
        token=inv.token,
        invite_url=f"{public_base_url()}/invite/{inv.token}",
        invited_by=inviter_name,
        created_at=inv.created_at,
        expires_at=inv.expires_at,
        accepted_at=inv.accepted_at,
    )


@router.post("/api/workspaces/{ws_id}/invites", response_model=InviteOut)
async def create_invite(
    ws_id: int,
    body: InviteCreate,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> InviteOut:
    me = _membership_or_404(db, user.id, ws_id)
    _require_role(me, "owner", "editor")

    # Don't invite an existing member
    existing_member = (
        db.query(Membership, User)
        .join(User, Membership.user_id == User.id)
        .filter(Membership.workspace_id == ws_id, User.email == body.email.lower())
        .first()
    )
    if existing_member:
        raise HTTPException(400, "Email này đã là thành viên của workspace.")

    # Reuse pending invite if any
    pending = (
        db.query(Invite)
        .filter(
            Invite.workspace_id == ws_id,
            Invite.email == body.email.lower(),
            Invite.accepted_at.is_(None),
        )
        .first()
    )
    if pending and pending.expires_at > datetime.now(timezone.utc):
        return _invite_to_out(pending, user.name or user.email)

    if pending:
        db.delete(pending)
        db.flush()

    inv = Invite(
        workspace_id=ws_id,
        email=body.email.lower(),
        role=body.role,
        token=secrets.token_urlsafe(24),
        invited_by_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _invite_to_out(inv, user.name or user.email)


@router.get("/api/workspaces/{ws_id}/invites", response_model=list[InviteOut])
async def list_invites(
    ws_id: int,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> list[InviteOut]:
    me = _membership_or_404(db, user.id, ws_id)
    _require_role(me, "owner", "editor")
    rows = (
        db.query(Invite, User)
        .join(User, Invite.invited_by_id == User.id)
        .filter(Invite.workspace_id == ws_id)
        .order_by(Invite.created_at.desc())
        .all()
    )
    return [_invite_to_out(inv, inviter.name or inviter.email) for (inv, inviter) in rows]


@router.delete("/api/invites/{invite_id}", status_code=204)
async def revoke_invite(
    invite_id: int,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
):
    inv = db.get(Invite, invite_id)
    if inv is None:
        raise HTTPException(404)
    me = _membership_or_404(db, user.id, inv.workspace_id)
    _require_role(me, "owner", "editor")
    db.delete(inv)
    db.commit()
    return


class InvitePublic(BaseModel):
    workspace_name: str
    invited_by: str
    role: str
    email: str
    expired: bool


@router.get("/api/invites/{token}", response_model=InvitePublic)
async def get_invite_public(token: str, db: Session = Depends(get_db)) -> InvitePublic:
    inv = db.query(Invite).filter(Invite.token == token).one_or_none()
    if not inv:
        raise HTTPException(404, "Lời mời không tồn tại hoặc đã bị thu hồi.")
    if inv.accepted_at is not None:
        raise HTTPException(400, "Lời mời này đã được chấp nhận.")
    ws = db.get(Workspace, inv.workspace_id)
    inviter = db.get(User, inv.invited_by_id)
    return InvitePublic(
        workspace_name=ws.name if ws else "Workspace",
        invited_by=(inviter.name or inviter.email) if inviter else "—",
        role=inv.role,
        email=inv.email,
        expired=inv.expires_at < datetime.now(timezone.utc),
    )


@router.post("/api/invites/{token}/accept")
async def accept_invite(
    token: str,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> dict:
    inv = db.query(Invite).filter(Invite.token == token).one_or_none()
    if not inv:
        raise HTTPException(404, "Lời mời không tồn tại.")
    if inv.accepted_at is not None:
        raise HTTPException(400, "Lời mời đã được chấp nhận.")
    if inv.expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "Lời mời đã hết hạn.")
    if inv.email.lower() != (user.email or "").lower():
        raise HTTPException(
            403,
            f"Lời mời này dành cho {inv.email} — bạn đang đăng nhập bằng {user.email}.",
        )

    ws = db.get(Workspace, inv.workspace_id)
    if ws is None:
        raise HTTPException(404, "Workspace không còn tồn tại.")

    # Already a member? mark accepted but skip share
    already = (
        db.query(Membership)
        .filter(Membership.workspace_id == ws.id, Membership.user_id == user.id)
        .first()
    )
    if not already:
        db.add(Membership(user_id=user.id, workspace_id=ws.id, role=inv.role, is_default=False))

        # Grant the invitee Drive access to the spreadsheet
        owner = db.get(User, ws.owner_id)
        if owner is not None:
            try:
                owner_tok = await access_token_for_user(owner)
                await _share_sheet(owner_tok, ws.sheet_id, user.email, inv.role)
            except Exception as e:  # noqa: BLE001
                logger.warning("Sheet share failed (membership still created): %s", e)

    inv.accepted_at = datetime.now(timezone.utc)
    db.commit()
    return {"workspace_id": ws.id, "name": ws.name}


# ─────────────────── Profile / Account ───────────────────


class ProfileUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


@router.patch("/api/me")
async def update_profile(
    body: ProfileUpdate,
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
) -> dict:
    user.name = body.name.strip()
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email, "picture": user.picture}


@router.delete("/api/me", status_code=204)
async def delete_account(
    user: User = Depends(current_user_required),
    db: Session = Depends(get_db),
):
    """
    Xoá user khỏi DB. Cascade sẽ xoá memberships & invites đã gửi.
    Nếu user là owner duy nhất của workspace → xoá luôn workspace (không xoá Sheet trên Drive).
    """
    # Owned workspaces — delete them too (cascades remove memberships)
    owned = db.query(Workspace).filter(Workspace.owner_id == user.id).all()
    for ws in owned:
        db.delete(ws)
    db.delete(user)
    db.commit()
    return

"""Tenant-aware Sheet operations.

Wraps either user_sheet (OAuth-token-based, multi-tenant) or sheet_client
(service-account, legacy) so route handlers don't have to branch.
"""
from __future__ import annotations

from typing import Any

from sheet_client import SheetClient
from tenant import TenantCtx
import user_sheet


# Cache legacy SheetClient by sheet_id+creds (typically just one)
_legacy_cache: dict[tuple[str, str], SheetClient] = {}


def _legacy(ctx: TenantCtx) -> SheetClient:
    key = (ctx.sheet_id, ctx.legacy_creds_path or "")
    cli = _legacy_cache.get(key)
    if cli is None:
        cli = SheetClient(ctx.sheet_id, ctx.legacy_creds_path)
        _legacy_cache[key] = cli
    return cli


async def list_transactions(ctx: TenantCtx) -> list[dict[str, Any]]:
    if ctx.mode == "user":
        return await user_sheet.list_transactions(ctx.access_token, ctx.sheet_id)
    return await _legacy(ctx).all_transactions()


async def append_transaction(ctx: TenantCtx, **kwargs) -> tuple[bool, str | None]:
    if ctx.mode == "user":
        return await user_sheet.append_transaction(ctx.access_token, ctx.sheet_id, **kwargs)
    return await _legacy(ctx).append_transaction(**kwargs)


async def get_so_du(ctx: TenantCtx) -> list[dict[str, Any]]:
    if ctx.mode == "user":
        return await user_sheet.get_so_du(ctx.access_token, ctx.sheet_id)
    return await _legacy(ctx).get_so_du()


async def save_so_du(ctx: TenantCtx, rows: list[dict[str, Any]]) -> None:
    if ctx.mode == "user":
        return await user_sheet.save_so_du(ctx.access_token, ctx.sheet_id, rows)
    return await _legacy(ctx).save_so_du(rows)


async def payment_methods(ctx: TenantCtx) -> list[str]:
    if ctx.mode == "user":
        rows = await user_sheet.get_so_du(ctx.access_token, ctx.sheet_id)
        return [r["name"] for r in rows if r["name"] != "SUM="]
    return await _legacy(ctx).payment_methods()


async def get_planning(ctx: TenantCtx, month: str) -> list[dict]:
    if ctx.mode == "user":
        return await user_sheet.get_planning(ctx.access_token, ctx.sheet_id, month)
    return await _legacy(ctx).get_planning(month)


async def save_planning(ctx: TenantCtx, month: str, rows: list[dict]) -> None:
    if ctx.mode == "user":
        return await user_sheet.save_planning(ctx.access_token, ctx.sheet_id, month, rows)
    return await _legacy(ctx).save_planning(month, rows)

"""Web API thu/chi — multi-tenant (Google OAuth) + legacy single-tenant fallback."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import tenant_ops
from config import api_key, auth_enabled, cors_origins
from db import init_db
from parser import parse_expense
from routes_account import router as account_router
from routes_auth import router as auth_router
from sheet_client import DEFAULT_FUNDS, cashflow_daily, summarize_month
from tenant import TenantCtx, resolve_tenant

logger = logging.getLogger(__name__)

SHEET_CATEGORIES = [
    "Ăn uống", "Mua sắm", "Học hành", "Xăng xe", "Di chuyển",
    "Hóa đơn", "Giải trí", "Sức khỏe", "Nhà cửa", "Khác",
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Thu Chi Web", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def check_api_key(request: Request, call_next):
    """Optional API-key gate for legacy mode. Skipped when multi-tenant auth is on."""
    if auth_enabled():
        return await call_next(request)
    key = api_key()
    public = {"/ping", "/api/health", "/auth/status"}
    if key and request.url.path.startswith("/api") and request.url.path not in public:
        if request.headers.get("X-API-Key") != key:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


app.include_router(auth_router)
app.include_router(account_router)


# ── Public health endpoints ──────────────────────────────────────────────────

@app.get("/ping")
async def ping():
    return {"ok": True}


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "auth_enabled": str(auth_enabled())}


@app.get("/api/meta")
async def meta() -> dict[str, Any]:
    return {
        "categories": SHEET_CATEGORIES,
        "funds": DEFAULT_FUNDS,
        "sheet": "Chi Tiêu",
    }


# ── Tenant-aware endpoints ───────────────────────────────────────────────────

class TransactionIn(BaseModel):
    amount: int = Field(..., ge=0)
    description: str = ""
    category: str = "Khác"
    payment_method: str = "Tiền mặt"
    thu_chi: Literal["Thu", "Chi"] = "Chi"
    date: Optional[str] = None
    note: str = ""


class ParseRequest(BaseModel):
    text: str


@app.post("/api/parse")
async def parse_text(
    body: ParseRequest,
    ctx: TenantCtx = Depends(resolve_tenant),
) -> dict:
    methods = await tenant_ops.payment_methods(ctx)
    return parse_expense(body.text, payment_methods=methods, categories=SHEET_CATEGORIES)


@app.get("/api/transactions")
async def list_transactions(ctx: TenantCtx = Depends(resolve_tenant)) -> list[dict]:
    return await tenant_ops.list_transactions(ctx)


@app.post("/api/transactions")
async def add_transaction(
    body: TransactionIn,
    ctx: TenantCtx = Depends(resolve_tenant),
) -> dict:
    d = body.date or datetime.now().strftime("%d/%m/%Y")
    ok, err = await tenant_ops.append_transaction(
        ctx,
        amount=body.amount,
        description=body.description,
        category=body.category,
        payment_method=body.payment_method,
        thu_chi=body.thu_chi,
        date_dd_mm_yyyy=d,
        note=body.note,
    )
    if not ok:
        raise HTTPException(400, err or "Không ghi được")
    return {"ok": True}


@app.get("/api/summary")
async def summary(month: str, ctx: TenantCtx = Depends(resolve_tenant)) -> dict:
    if len(month) != 7 or "/" not in month:
        raise HTTPException(400, "month phải là MM/YYYY")
    rows = await tenant_ops.list_transactions(ctx)
    return summarize_month(rows, month)


@app.get("/api/summary/range")
async def summary_range(
    months_back: int = 6,
    ctx: TenantCtx = Depends(resolve_tenant),
) -> list[dict]:
    rows = await tenant_ops.list_transactions(ctx)
    now = datetime.now()
    out = []
    for i in range(months_back):
        y, m = now.year, now.month - i
        while m <= 0:
            m += 12
            y -= 1
        s = summarize_month(rows, f"{m:02d}/{y}")
        s["month"] = f"{m:02d}/{y}"
        out.append(s)
    return list(reversed(out))


@app.get("/api/cashflow")
async def cashflow(
    date_from: str,
    date_to: str,
    ctx: TenantCtx = Depends(resolve_tenant),
) -> dict:
    rows = await tenant_ops.list_transactions(ctx)
    try:
        return cashflow_daily(rows, date_from, date_to)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/accounts")
async def accounts(ctx: TenantCtx = Depends(resolve_tenant)) -> dict[str, Any]:
    try:
        rows = await tenant_ops.get_so_du(ctx)
        methods = [r["name"] for r in rows]
    except Exception:
        methods = await tenant_ops.payment_methods(ctx)
        rows = [{"name": m, "dau_ky": None, "hien_co": None} for m in methods]
    return {"payment_methods": methods, "rows": rows}


class PlanRowIn(BaseModel):
    fund: str
    percent: float = 0
    amount: int = 0
    note: str = ""


class PlanSave(BaseModel):
    month: str = Field(..., pattern=r"^\d{2}/\d{4}$")
    rows: list[PlanRowIn]


@app.get("/api/planning")
async def get_planning(month: str, ctx: TenantCtx = Depends(resolve_tenant)) -> list[dict]:
    data = await tenant_ops.get_planning(ctx, month)
    existing = {r["fund"]: r for r in data}
    merged = []
    for f in DEFAULT_FUNDS:
        merged.append(existing.get(f, {
            "month": month, "fund": f, "percent": 0.0,
            "amount": 0, "note": "", "updated": "",
        }))
    return merged


@app.post("/api/planning")
async def post_planning(
    body: PlanSave,
    ctx: TenantCtx = Depends(resolve_tenant),
) -> dict:
    rows = [r.model_dump() for r in body.rows]
    await tenant_ops.save_planning(ctx, body.month, rows)
    return {"ok": True}


# ── Static UI (sau khi npm run build) ────────────────────────────────────────

_STATIC = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


@app.get("/")
async def spa_root():
    index = os.path.join(_STATIC, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    return JSONResponse({"hint": "Build frontend trước (npm run build).", "api": "/api/health"})


# Serve all SPA routes (login, app, onboarding, profile, …) via index.html
@app.get("/{full_path:path}")
async def spa_catchall(full_path: str):
    if full_path.startswith(("api", "auth", "ping", "assets")):
        raise HTTPException(404)
    index = os.path.join(_STATIC, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    raise HTTPException(404)


if os.path.isdir(_STATIC):
    app.mount("/assets", StaticFiles(directory=os.path.join(_STATIC, "assets")), name="assets")

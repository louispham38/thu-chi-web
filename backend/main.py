"""Web API thu/chi — dùng chung Google Sheet với OpenClaw Bot."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import api_key, cors_origins, credentials_path, spreadsheet_id
from parser import parse_expense
from sheet_client import DEFAULT_FUNDS, SheetClient, cashflow_daily, summarize_month

SHEET_CATEGORIES = [
    "Ăn uống",
    "Mua sắm",
    "Học hành",
    "Xăng xe",
    "Di chuyển",
    "Hóa đơn",
    "Giải trí",
    "Sức khỏe",
    "Nhà cửa",
    "Khác",
]

client: Optional[SheetClient] = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global client
    cred = credentials_path()
    sid = spreadsheet_id()
    if not os.path.isfile(cred):
        raise RuntimeError(f"Không tìm thấy credentials: {cred}")
    client = SheetClient(sid, cred)
    yield
    client = None


app = FastAPI(title="Thu Chi Web", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def check_api_key(request: Request, call_next):
    key = api_key()
    # /ping và /api/health luôn public — dùng cho UptimeRobot / Render health check
    public = {"/ping", "/api/health"}
    if key and request.url.path.startswith("/api") and request.url.path not in public:
        if request.headers.get("X-API-Key") != key:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


def c() -> SheetClient:
    if client is None:
        raise HTTPException(503, "Chưa khởi tạo kết nối Sheet")
    return client


@app.get("/ping")
async def ping():
    """Lightweight keepalive — dùng cho UptimeRobot, không gọi Google Sheets."""
    return {"ok": True}


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "sheet": spreadsheet_id()[:8] + "…"}


@app.get("/api/meta")
async def meta() -> dict[str, Any]:
    return {
        "categories": SHEET_CATEGORIES,
        "funds": DEFAULT_FUNDS,
        "sheet": "Chi Tiêu",
    }


class TransactionIn(BaseModel):
    amount: int = Field(..., ge=0)
    description: str = ""
    category: str = "Khác"
    payment_method: str = "Tiền mặt"
    thu_chi: Literal["Thu", "Chi"] = "Chi"
    date: Optional[str] = None  # dd/mm/yyyy
    note: str = ""


class ParseRequest(BaseModel):
    text: str


@app.post("/api/parse")
async def parse_text(body: ParseRequest) -> dict:
    """Parse natural-language expense text into structured fields."""
    methods = await c().payment_methods()
    result = parse_expense(body.text, payment_methods=methods, categories=SHEET_CATEGORIES)
    return result


@app.get("/api/transactions")
async def list_transactions() -> list[dict]:
    return await c().all_transactions()


@app.post("/api/transactions")
async def add_transaction(body: TransactionIn) -> dict:
    d = body.date
    if not d:
        d = datetime.now().strftime("%d/%m/%Y")
    ok, err = await c().append_transaction(
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
    return {"ok": True, "message": "Đã ghi vào Google Sheet"}


@app.get("/api/summary")
async def summary(month: str) -> dict:
    """month = MM/YYYY"""
    if len(month) != 7 or "/" not in month:
        raise HTTPException(400, "month phải là MM/YYYY")
    rows = await c().all_transactions()
    return summarize_month(rows, month)


@app.get("/api/summary/range")
async def summary_range(months_back: int = 6) -> list[dict]:
    rows = await c().all_transactions()
    now = datetime.now()
    out = []
    for i in range(months_back):
        y, m = now.year, now.month - i
        while m <= 0:
            m += 12
            y -= 1
        mm_yyyy = f"{m:02d}/{y}"
        s = summarize_month(rows, mm_yyyy)
        s["month"] = mm_yyyy
        out.append(s)
    return list(reversed(out))


@app.get("/api/cashflow")
async def cashflow(date_from: str, date_to: str) -> dict:
    """Daily Thu/Chi/balance for [date_from, date_to] (dd/mm/yyyy inclusive)."""
    rows = await c().all_transactions()
    try:
        return cashflow_daily(rows, date_from, date_to)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/accounts")
async def accounts() -> dict[str, Any]:
    try:
        rows = await c().get_so_du()
        methods = [r["name"] for r in rows]
    except Exception:
        methods = await c().payment_methods()
        rows = [{"name": m, "dau_ky": None, "hien_co": None} for m in methods]
    return {"payment_methods": methods, "rows": rows}


class PlanRowIn(BaseModel):
    fund: str
    percent: float = 0
    amount: int = 0
    note: str = ""


class PlanSave(BaseModel):
    month: str = Field(..., pattern=r"^\d{2}/\d{4}$")  # MM/YYYY
    rows: list[PlanRowIn]


@app.get("/api/planning")
async def get_planning(month: str) -> list[dict]:
    data = await c().get_planning(month)
    existing = {r["fund"]: r for r in data}
    merged = []
    for f in DEFAULT_FUNDS:
        if f in existing:
            merged.append(existing[f])
        else:
            merged.append(
                {
                    "month": month,
                    "fund": f,
                    "percent": 0.0,
                    "amount": 0,
                    "note": "",
                    "updated": "",
                }
            )
    return merged


@app.post("/api/planning")
async def post_planning(body: PlanSave) -> dict:
    rows = [r.model_dump() for r in body.rows]
    await c().save_planning(body.month, rows)
    return {"ok": True}


# Static UI (sau khi npm run build)
_STATIC = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


@app.get("/")
async def spa_root():
    index = os.path.join(_STATIC, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    return JSONResponse(
        {
            "hint": "Chạy frontend: cd frontend && npm install && npm run dev "
            "— hoặc npm run build để phục vụ từ /",
            "api": "/api/health",
        }
    )


if os.path.isdir(_STATIC):
    app.mount("/assets", StaticFiles(directory=os.path.join(_STATIC, "assets")), name="assets")


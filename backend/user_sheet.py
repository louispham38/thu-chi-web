"""Per-user Google Sheets/Drive operations using their OAuth access token.

Used by multi-tenant routes (one Sheet per workspace, owned by user).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import gspread
from google.oauth2.credentials import Credentials

logger = logging.getLogger(__name__)

# ── Bootstrap layout for newly-created sheets ────────────────────────────────
CHI_TIEU_HEADERS = [
    "Ngày", "Giờ", "Thu/Chi", "Phương thức", "Danh mục", "Mô tả", "Số tiền (VND)", "Ghi chú",
]
SO_DU_HEADERS = ["Nguồn", "Đầu kỳ", "Hiện có"]
SO_DU_DEFAULT_ROWS = [
    ["Tiền mặt", 0, 0],
    ["Techcombank", 0, 0],
    ["Vietcombank", 0, 0],
    ["Vpbank", 0, 0],
    ["Momo", 0, 0],
    ["SUM=", 0, 0],
]
KE_HOACH_HEADERS = ["Tháng", "Quỹ", "Phần trăm", "Số tiền (VND)", "Ghi chú", "Cập nhật"]


def _client_from_token(access_token: str) -> gspread.Client:
    creds = Credentials(token=access_token)
    return gspread.authorize(creds)


def _create_workbook_sync(access_token: str, title: str) -> str:
    """Create a new Google Sheet in the user's Drive and seed the tabs."""
    cli = _client_from_token(access_token)
    sh = cli.create(title)
    # Tab 1: rename default Sheet1 → Chi Tiêu
    ws = sh.sheet1
    ws.update_title("Chi Tiêu")
    ws.append_row(CHI_TIEU_HEADERS, value_input_option="USER_ENTERED")
    # Tab 2: So_Du
    so_du = sh.add_worksheet(title="So_Du", rows=50, cols=len(SO_DU_HEADERS))
    so_du.append_row(SO_DU_HEADERS, value_input_option="USER_ENTERED")
    if hasattr(so_du, "append_rows"):
        so_du.append_rows(SO_DU_DEFAULT_ROWS, value_input_option="USER_ENTERED")
    else:
        for r in SO_DU_DEFAULT_ROWS:
            so_du.append_row(r, value_input_option="USER_ENTERED")
    # Tab 3: Ke_Hoach_Quy
    plan = sh.add_worksheet(title="Ke_Hoach_Quy", rows=200, cols=len(KE_HOACH_HEADERS))
    plan.append_row(KE_HOACH_HEADERS, value_input_option="USER_ENTERED")
    return sh.id


async def create_workbook(access_token: str, title: str = "Thu/Chi của tôi") -> str:
    return await asyncio.to_thread(_create_workbook_sync, access_token, title)


# ── Read/write operations parameterised by access_token + sheet_id ──────────

def _open_sync(access_token: str, sheet_id: str):
    return _client_from_token(access_token).open_by_key(sheet_id)


async def list_transactions(access_token: str, sheet_id: str) -> list[dict[str, Any]]:
    """Read all rows from 'Chi Tiêu' tab, normalising date serials and VND amounts.

    Reuses the robust parsers from `sheets_manager` so adopted legacy sheets
    (which store dates as serials and amounts with VN-style separators or ₫
    suffix) are read correctly.
    """
    from sheets_manager import (
        _parse_ngay_cell_to_dd_mm_yyyy,
        _parse_vnd_amount,
        _record_thu_chi_value,
    )

    def _read():
        sh = _open_sync(access_token, sheet_id)
        ws = sh.worksheet("Chi Tiêu")
        try:
            rows = ws.get_all_records(value_render_option="UNFORMATTED_VALUE")
        except TypeError:
            rows = ws.get_all_records()
        out = []
        for r in rows:
            out.append({
                "date": _parse_ngay_cell_to_dd_mm_yyyy(r.get("Ngày")),
                "time": str(r.get("Giờ", "")).strip(),
                "thu_chi": _record_thu_chi_value(r),
                "payment_method": str(r.get("Phương thức", "")).strip(),
                "category": str(r.get("Danh mục", "Khác")).strip() or "Khác",
                "description": str(r.get("Mô tả", "")).strip(),
                "amount": _parse_vnd_amount(r.get("Số tiền (VND)")),
                "note": str(r.get("Ghi chú", "")).strip(),
            })
        return out

    return await asyncio.to_thread(_read)


async def append_transaction(
    access_token: str,
    sheet_id: str,
    *,
    amount: int,
    description: str,
    category: str,
    payment_method: str,
    thu_chi: str,
    date_dd_mm_yyyy: str,
    note: str = "",
) -> tuple[bool, str | None]:
    from datetime import datetime

    def _write():
        sh = _open_sync(access_token, sheet_id)
        ws = sh.worksheet("Chi Tiêu")
        time_str = datetime.now().strftime("%H:%M:%S")
        ws.append_row(
            [
                date_dd_mm_yyyy,
                time_str,
                thu_chi,
                payment_method,
                category,
                description,
                amount,
                note,
            ],
            value_input_option="USER_ENTERED",
        )
        return True, None

    try:
        return await asyncio.to_thread(_write)
    except Exception as e:  # noqa: BLE001
        logger.exception("append_transaction failed")
        return False, str(e)


async def get_so_du(access_token: str, sheet_id: str) -> list[dict[str, Any]]:
    def _to_int(v) -> int:
        if v is None or v == "":
            return 0
        try:
            return int(float(str(v).replace(",", "").replace(".", "").replace(" ", "").replace("đ", "").strip()))
        except (ValueError, TypeError):
            return 0

    def _read():
        sh = _open_sync(access_token, sheet_id)
        ws = sh.worksheet("So_Du")
        names = ws.col_values(1)
        try:
            dau = ws.col_values(2, value_render_option="UNFORMATTED_VALUE")
            hien = ws.col_values(3, value_render_option="UNFORMATTED_VALUE")
        except TypeError:
            dau = ws.col_values(2)
            hien = ws.col_values(3)
        start = 0
        if names and names[0].strip().lower() in ("nguồn", "nguon", "tài khoản"):
            start = 1
        out = []
        for i, n in enumerate(names[start:], start=start):
            n = n.strip()
            if not n:
                continue
            out.append({
                "name": n,
                "dau_ky": _to_int(dau[i] if i < len(dau) else 0),
                "hien_co": _to_int(hien[i] if i < len(hien) else 0),
            })
        return out

    return await asyncio.to_thread(_read)


async def save_so_du(
    access_token: str,
    sheet_id: str,
    rows: list[dict[str, Any]],
) -> None:
    """Overwrite the So_Du tab with `rows` (excluding any SUM=/header).

    Layout written: header + data rows + SUM= formula row. Using
    USER_ENTERED so that "=SUM(...)" cells become live formulas.
    """

    def _to_int(v) -> int:
        if v is None or v == "":
            return 0
        try:
            return int(float(str(v).replace(",", "").replace(".", "").strip()))
        except (ValueError, TypeError):
            return 0

    def _write():
        sh = _open_sync(access_token, sheet_id)
        try:
            ws = sh.worksheet("So_Du")
        except gspread.WorksheetNotFound:
            ws = sh.add_worksheet(title="So_Du", rows=max(50, len(rows) + 5), cols=len(SO_DU_HEADERS))

        body: list[list] = [list(SO_DU_HEADERS)]
        for r in rows:
            name = str(r.get("name", "")).strip()
            if not name or name == "SUM=":
                continue
            body.append([name, _to_int(r.get("dau_ky")), _to_int(r.get("hien_co"))])

        n = len(body) - 1  # number of data rows just appended
        if n > 0:
            last = n + 1  # 1-based row index of the last data row
            body.append(["SUM=", f"=SUM(B2:B{last})", f"=SUM(C2:C{last})"])
        else:
            body.append(["SUM=", 0, 0])

        ws.clear()
        ws.update("A1", body, value_input_option="USER_ENTERED")

    await asyncio.to_thread(_write)


async def get_planning(access_token: str, sheet_id: str, month: str) -> list[dict]:
    from sheets_manager import _parse_vnd_amount

    def _read():
        sh = _open_sync(access_token, sheet_id)
        try:
            ws = sh.worksheet("Ke_Hoach_Quy")
        except gspread.WorksheetNotFound:
            return []
        rows = ws.get_all_records()
        out = []
        for r in rows:
            if str(r.get("Tháng", "")).strip() == month.strip():
                try:
                    pct = float(str(r.get("Phần trăm") or 0).replace("%", "").replace(",", ".") or 0)
                except (ValueError, TypeError):
                    pct = 0.0
                out.append({
                    "month": r.get("Tháng", ""),
                    "fund": r.get("Quỹ", ""),
                    "percent": pct,
                    "amount": _parse_vnd_amount(r.get("Số tiền (VND)")),
                    "note": r.get("Ghi chú", ""),
                    "updated": r.get("Cập nhật", ""),
                })
        return out

    return await asyncio.to_thread(_read)


async def save_planning(access_token: str, sheet_id: str, month: str, rows: list[dict]) -> None:
    from datetime import datetime

    def _write():
        sh = _open_sync(access_token, sheet_id)
        try:
            ws = sh.worksheet("Ke_Hoach_Quy")
        except gspread.WorksheetNotFound:
            ws = sh.add_worksheet(title="Ke_Hoach_Quy", rows=200, cols=len(KE_HOACH_HEADERS))
            ws.append_row(KE_HOACH_HEADERS, value_input_option="USER_ENTERED")
        all_rows = ws.get_all_values()
        header = all_rows[0] if all_rows else KE_HOACH_HEADERS
        body: list[list] = [header]
        for row in all_rows[1:]:
            if not row:
                continue
            if str(row[0]).strip() == month.strip():
                continue
            padded = row + [""] * max(0, len(header) - len(row))
            body.append(padded[: len(header)])
        now = datetime.now().strftime("%d/%m/%Y %H:%M")
        for item in rows:
            body.append([
                month,
                item.get("fund", ""),
                float(item.get("percent") or 0),
                int(item.get("amount") or 0),
                item.get("note", ""),
                now,
            ])
        ws.clear()
        if hasattr(ws, "append_rows"):
            ws.append_rows(body, value_input_option="USER_ENTERED")
        else:
            for row in body:
                ws.append_row(row, value_input_option="USER_ENTERED")

    await asyncio.to_thread(_write)

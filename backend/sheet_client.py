"""Client Google Sheets — dùng chung spreadsheet với Bot Telegram."""
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

from sheets_manager import SheetsManager

PLAN_SHEET = "Ke_Hoach_Quy"
PLAN_HEADERS = ["Tháng", "Quỹ", "Phần trăm", "Số tiền (VND)", "Ghi chú", "Cập nhật"]

DEFAULT_FUNDS = [
    "Sinh hoạt phí",
    "Tích luỹ",
    "Đầu tư",
    "Dự phòng",
    "Cho đi",
    "Quỹ hưu",
    "Quỹ đầu tư tương lai",
]


class SheetClient:
    def __init__(self, spreadsheet_id: str, credentials_file: str) -> None:
        self._mgr = SheetsManager(spreadsheet_id, credentials_file)

    async def all_transactions(self) -> list[dict]:
        raw = await self._mgr.get_all_expenses()
        return self._mgr.normalize_records(raw)

    async def append_transaction(
        self,
        *,
        amount: int,
        description: str,
        category: str,
        payment_method: str,
        thu_chi: str,
        date_dd_mm_yyyy: str | None,
        note: str = "",
    ) -> tuple[bool, str | None]:
        data = {
            "amount": amount,
            "description": description,
            "category": category,
            "payment_method": payment_method,
            "thu_chi": thu_chi,
            "note": note,
        }
        if date_dd_mm_yyyy:
            data["date"] = date_dd_mm_yyyy
        return await self._mgr.append_row(data)

    async def payment_methods(self) -> list[str]:
        return await self._mgr.get_allowed_payment_methods()

    async def get_so_du(self) -> list[dict]:
        """Đọc toàn bộ sheet So_Du: Nguồn, Đầu kỳ, Hiện có."""

        def _to_int(v) -> int:
            if v is None or v == "":
                return 0
            try:
                return int(float(str(v).replace(",", "").replace(".", "").replace(" ", "").replace("đ", "").strip()))
            except (ValueError, TypeError):
                return 0

        def _read():
            from sheets_manager import SO_DU_SHEET

            client = self._mgr._get_client()
            sh = client.open_by_key(self._mgr.spreadsheet_id)
            ws = sh.worksheet(SO_DU_SHEET)

            # Fetch names (col A) as formatted strings
            names = ws.col_values(1)
            # Fetch numeric columns unformatted to get raw numbers
            try:
                dau_ky_vals = ws.col_values(2, value_render_option="UNFORMATTED_VALUE")
                hien_co_vals = ws.col_values(3, value_render_option="UNFORMATTED_VALUE")
            except TypeError:
                # Older gspread without value_render_option
                dau_ky_vals = ws.col_values(2)
                hien_co_vals = ws.col_values(3)

            # Detect header row
            start = 0
            if names and names[0].strip().lower() in ("nguồn", "nguon", "tài khoản", "nguon"):
                start = 1

            out = []
            for i, name in enumerate(names[start:], start=start):
                name = name.strip()
                if not name:
                    continue
                dau = dau_ky_vals[i] if i < len(dau_ky_vals) else 0
                hien = hien_co_vals[i] if i < len(hien_co_vals) else 0
                out.append({
                    "name": name,
                    "dau_ky": _to_int(dau),
                    "hien_co": _to_int(hien),
                })
            return out

        return await asyncio.to_thread(_read)

    def _plan_ws_sync(self):
        import gspread

        client = self._mgr._get_client()
        sh = client.open_by_key(self._mgr.spreadsheet_id)
        try:
            return sh.worksheet(PLAN_SHEET)
        except gspread.WorksheetNotFound:
            ws = sh.add_worksheet(title=PLAN_SHEET, rows=500, cols=len(PLAN_HEADERS))
            ws.append_row(PLAN_HEADERS)
            return ws

    async def get_planning(self, month_yyyy_mm: str) -> list[dict]:
        """month_yyyy_mm = MM/YYYY"""

        def _read():
            ws = self._plan_ws_sync()
            rows = ws.get_all_records()
            out = []
            for r in rows:
                if str(r.get("Tháng", "")).strip() == month_yyyy_mm.strip():
                    out.append(
                        {
                            "month": r.get("Tháng", ""),
                            "fund": r.get("Quỹ", ""),
                            "percent": float(r.get("Phần trăm") or 0),
                            "amount": int(float(str(r.get("Số tiền (VND)", "0")).replace(",", "") or 0)),
                            "note": r.get("Ghi chú", ""),
                            "updated": r.get("Cập nhật", ""),
                        }
                    )
            return out

        return await asyncio.to_thread(_read)

    async def save_planning(
        self,
        month_yyyy_mm: str,
        rows: list[dict],
    ) -> None:
        """rows: fund, percent, amount, note"""

        def _write():
            ws = self._plan_ws_sync()
            all_rows = ws.get_all_values()
            if not all_rows:
                ws.append_row(PLAN_HEADERS)
                all_rows = [PLAN_HEADERS]
            header = all_rows[0]
            if len(header) < len(PLAN_HEADERS):
                header = PLAN_HEADERS
                all_rows[0] = header
            mt = month_yyyy_mm.strip()
            body: list[list] = [header]
            for row in all_rows[1:]:
                if not row:
                    continue
                if str(row[0]).strip() == mt:
                    continue
                padded = row + [""] * max(0, len(header) - len(row))
                body.append(padded[: len(header)])
            now = datetime.now().strftime("%d/%m/%Y %H:%M")
            for item in rows:
                body.append(
                    [
                        mt,
                        item.get("fund", ""),
                        float(item.get("percent") or 0),
                        int(item.get("amount") or 0),
                        item.get("note", ""),
                        now,
                    ]
                )
            ws.clear()
            if hasattr(ws, "append_rows"):
                ws.append_rows(body, value_input_option="USER_ENTERED")
            else:
                for row in body:
                    ws.append_row(row, value_input_option="USER_ENTERED")

        await asyncio.to_thread(_write)


def summarize_month(records: list[dict], month_mm_yyyy: str) -> dict:
    """month_mm_yyyy = MM/YYYY; date trong record là dd/mm/yyyy."""
    thu = chi = 0
    by_cat: dict[str, int] = {}
    target = month_mm_yyyy.strip()
    for r in records:
        d = r.get("date") or ""
        tail = d[3:].strip() if len(d) >= 10 else ""
        if tail == target:
            amt = int(r.get("amount") or 0)
            tc = r.get("thu_chi") or "Chi"
            if tc == "Thu":
                thu += amt
            else:
                chi += amt
            cat = r.get("category") or "Khác"
            by_cat[cat] = by_cat.get(cat, 0) + (amt if tc == "Chi" else 0)
    return {"thu": thu, "chi": chi, "balance": thu - chi, "by_category": by_cat}

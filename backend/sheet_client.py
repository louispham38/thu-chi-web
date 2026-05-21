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

    async def save_so_du(self, rows: list[dict]) -> None:
        """Overwrite So_Du with provided rows (data only; we re-emit header + SUM=)."""

        from sheets_manager import SO_DU_SHEET

        def _to_int(v) -> int:
            if v is None or v == "":
                return 0
            try:
                return int(float(str(v).replace(",", "").replace(".", "").strip()))
            except (ValueError, TypeError):
                return 0

        def _write():
            client = self._mgr._get_client()
            sh = client.open_by_key(self._mgr.spreadsheet_id)
            try:
                ws = sh.worksheet(SO_DU_SHEET)
            except Exception:
                ws = sh.add_worksheet(
                    title=SO_DU_SHEET, rows=max(50, len(rows) + 5), cols=3
                )

            body: list[list] = [["Nguồn", "Đầu kỳ", "Hiện có"]]
            for r in rows:
                name = str(r.get("name", "")).strip()
                if not name or name == "SUM=":
                    continue
                body.append([name, _to_int(r.get("dau_ky")), _to_int(r.get("hien_co"))])

            n = len(body) - 1
            if n > 0:
                last = n + 1
                body.append(["SUM=", f"=SUM(B2:B{last})", f"=SUM(C2:C{last})"])
            else:
                body.append(["SUM=", 0, 0])

            ws.clear()
            ws.update("A1", body, value_input_option="USER_ENTERED")
            self._mgr._payment_methods_cache = None

        await asyncio.to_thread(_write)

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


def _parse_dmy(s: str):
    """dd/mm/yyyy -> datetime.date or None."""
    from datetime import date as _date
    s = (s or "").strip()
    if len(s) < 10:
        return None
    try:
        d, m, y = s[:10].split("/")
        return _date(int(y), int(m), int(d))
    except (ValueError, IndexError):
        return None


def cashflow_daily(records: list[dict], date_from: str, date_to: str) -> dict:
    """
    Aggregate transactions per day between [date_from, date_to] (inclusive).
    Inputs are dd/mm/yyyy; returns:
      {
        "from": "...", "to": "...",
        "totals": {"thu": .., "chi": .., "balance": .., "tx_count": ..},
        "days": [{date, thu, chi, balance, count}, ...]   # all days in range
      }
    """
    from datetime import date, timedelta

    df = _parse_dmy(date_from)
    dt = _parse_dmy(date_to)
    if df is None or dt is None or df > dt:
        raise ValueError("Khoảng ngày không hợp lệ (dd/mm/yyyy).")

    by_day: dict[str, dict[str, int]] = {}
    total_thu = total_chi = total_count = 0
    for r in records:
        rd = _parse_dmy(r.get("date") or "")
        if rd is None or rd < df or rd > dt:
            continue
        amt = int(r.get("amount") or 0)
        tc = r.get("thu_chi") or "Chi"
        key = rd.strftime("%d/%m/%Y")
        bucket = by_day.setdefault(key, {"thu": 0, "chi": 0, "count": 0})
        if tc == "Thu":
            bucket["thu"] += amt
            total_thu += amt
        else:
            bucket["chi"] += amt
            total_chi += amt
        bucket["count"] += 1
        total_count += 1

    days = []
    one = timedelta(days=1)
    cur = df
    while cur <= dt:
        key = cur.strftime("%d/%m/%Y")
        b = by_day.get(key, {"thu": 0, "chi": 0, "count": 0})
        days.append({
            "date": key,
            "weekday": cur.weekday(),  # 0=Mon..6=Sun
            "thu": b["thu"],
            "chi": b["chi"],
            "balance": b["thu"] - b["chi"],
            "count": b["count"],
        })
        cur += one

    return {
        "from": df.strftime("%d/%m/%Y"),
        "to": dt.strftime("%d/%m/%Y"),
        "totals": {
            "thu": total_thu,
            "chi": total_chi,
            "balance": total_thu - total_chi,
            "tx_count": total_count,
            "day_count": len(days),
        },
        "days": days,
    }


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

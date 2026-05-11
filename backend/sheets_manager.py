"""
Google Sheets Manager
- Tạo và quản lý sheet chi tiêu
- Thêm, xóa, đọc dữ liệu
"""

import asyncio
import json
import logging
import os
import re
import unicodedata
import threading
import time
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from typing import Optional, Tuple, Union

from payment_methods import DEFAULT_PAYMENT_METHODS, parse_so_du_column_a, resolve_payment_method

import gspread
from google.oauth2.service_account import Credentials

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Tên sheet và cấu trúc cột
SHEET_NAME = "Chi Tiêu"
SO_DU_SHEET = "So_Du"
HEADERS = [
    "Ngày",
    "Giờ",
    "Thu/Chi",
    "Phương thức",
    "Danh mục",
    "Mô tả",
    "Số tiền (VND)",
    "Ghi chú",
]

# Google Sheets / Excel serial: số nguyên từ 1899-12-30 (giống Sheets khi nhập ngày).
_SHEETS_DATE_ORIGIN = date(1899, 12, 30)
_NGAY_COLUMN_FORMAT = {
    "numberFormat": {"type": "DATE", "pattern": "dd/mm/yyyy"},
}


def _date_to_sheets_serial(d: date) -> int:
    return (d - _SHEETS_DATE_ORIGIN).days


def _parse_ngay_cell_to_dd_mm_yyyy(raw: Union[str, int, float, None]) -> str:
    """Chuẩn hóa ô Ngày (serial, số thực, hoặc chuỗi dd/mm/yyyy) → dd/mm/yyyy."""
    if raw is None or raw == "":
        return ""
    if isinstance(raw, bool):
        return ""
    if isinstance(raw, (int, float)):
        try:
            d = _SHEETS_DATE_ORIGIN + timedelta(days=int(raw))
            return d.strftime("%d/%m/%Y")
        except (OverflowError, ValueError, OSError):
            return str(raw)
    s = str(raw).strip()
    if not s:
        return ""
    if s.replace(".", "", 1).isdigit():
        try:
            serial = int(float(s))
            if 1 <= serial <= 200000:
                d = _SHEETS_DATE_ORIGIN + timedelta(days=serial)
                return d.strftime("%d/%m/%Y")
        except (OverflowError, ValueError, OSError):
            pass
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%d/%m/%Y")
        except ValueError:
            continue
    return s


def _coerce_input_date_to_serial(data_date: Union[str, date, datetime, None]) -> int:
    """Từ CLI (chuỗi dd/mm/yyyy hoặc datetime) → serial Sheets."""
    if isinstance(data_date, datetime):
        d = data_date.date()
    elif isinstance(data_date, date):
        d = data_date
    elif isinstance(data_date, str) and data_date.strip():
        s = data_date.strip()
        d = None
        for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
            try:
                d = datetime.strptime(s, fmt).date()
                break
            except ValueError:
                continue
        if d is None:
            d = datetime.now().date()
    else:
        d = datetime.now().date()
    return _date_to_sheets_serial(d)


def _ensure_ngay_column_date_format(sheet: gspread.Worksheet) -> None:
    """Định dạng cột Ngày (A2:A) hiển thị dd/mm/yyyy kiểu Date."""
    try:
        sheet.format("A2:A10000", _NGAY_COLUMN_FORMAT)
    except Exception as e:
        logger.warning("Không set định dạng cột Ngày: %s", e)


def _norm_header_cell(s: str) -> str:
    return re.sub(r"\s+", "", str(s).strip().lower())


def _is_thu_chi_header(cell: str) -> bool:
    """Nhận Thu/Chi, Thu Chi, Loại, v.v. (sheet chỉnh tay)."""
    n = _norm_header_cell(cell)
    if not n:
        return False
    return n in ("thuchi", "thu/chi", "thu-chi", "loại", "loai") or (
        "thu" in n and "chi" in n
    )


def _find_thu_chi_col_index(header: list) -> Optional[int]:
    for i, h in enumerate(header):
        if _is_thu_chi_header(h):
            return i
    return None


def _is_payment_method_header(cell: str) -> bool:
    n = _norm_header_cell(cell)
    return n in ("phươngthức", "phuongthuc") or (
        "phương" in n and "thức" in n
    )


def _record_thu_chi_value(r: dict) -> str:
    """Lấy Thu/Chi từ dict get_all_records (key khớp đúng tiêu đề ô trong sheet)."""
    for key, val in r.items():
        if _is_thu_chi_header(key):
            s = str(val).strip() if val is not None else ""
            return s if s in ("Thu", "Chi") else "Chi"
    v = r.get("Thu/Chi")
    if v is not None and str(v).strip() in ("Thu", "Chi"):
        return str(v).strip()
    return "Chi"


def _parse_vnd_amount(raw) -> int:
    """Parse số tiền từ ô Sheet (số thuần, hoặc chuỗi có ₫ / dấu phân cách VN)."""
    if raw is None or raw == "":
        return 0
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return int(raw)
    s = str(raw).strip()
    s = re.sub(r"[₫đ]", "", s, flags=re.IGNORECASE)
    s = s.replace("VND", "").replace("\u00a0", "").replace(" ", "")
    s = s.replace(",", "").replace(".", "")
    return int(s) if s.isdigit() else 0


def _norm_dedup_text(s: str) -> str:
    """Chuẩn hóa mô tả/ghi chú để so trùng (lệnh add-image nhiều lần / model khác NH)."""
    t = unicodedata.normalize("NFKC", (s or "").strip().lower())
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _sheet_amount_key(row: dict) -> int:
    for k in ("Số tiền (VND)", "Số tiền", "So tien"):
        if k in row and row[k] not in (None, ""):
            return _parse_vnd_amount(row[k])
    return 0


def _find_recent_duplicate_row(
    date_dd_mm_yyyy: str,
    thu_chi: str,
    amount: int,
    description: str,
    note: str,
    records: list[dict],
    *,
    lookback: int = 45,
    ratio_threshold: float = 0.86,
) -> Optional[str]:
    """Trả về thông báo lỗi nếu đã có dòng gần giống (chống ghi 2–3 lần cùng biên lai)."""
    if amount <= 0 or thu_chi not in ("Thu", "Chi"):
        return None
    blob_new = _norm_dedup_text(f"{description} {note}")
    if len(blob_new) < 8:
        return None

    tail = records[-lookback:] if len(records) > lookback else records
    for row in reversed(tail):
        d = _parse_ngay_cell_to_dd_mm_yyyy(row.get("Ngày"))
        if d != date_dd_mm_yyyy:
            continue
        if _record_thu_chi_value(row) != thu_chi:
            continue
        if _sheet_amount_key(row) != int(amount):
            continue
        desc_o = str(row.get("Mô tả", "") or "")
        note_o = str(row.get("Ghi chú", "") or "")
        blob_old = _norm_dedup_text(f"{desc_o} {note_o}")
        if len(blob_old) < 8:
            continue
        ratio = SequenceMatcher(None, blob_new, blob_old).ratio()
        if ratio >= ratio_threshold:
            return (
                f"Trùng giao dịch đã có trên sheet (ngày {date_dd_mm_yyyy}, {thu_chi}, {int(amount):,} VND, "
                f"độ giống mô tả {ratio:.0%}). Không ghi thêm. "
                f"Nếu đúng là hai lệnh khác nhau, đặt BOT_MONEY_SKIP_DEDUP=1 rồi chạy lại."
            ).replace(",", ".")

    return None


def _ensure_sheet_schema(sheet: gspread.Worksheet) -> None:
    """Chèn cột Thu/Chi (sau Giờ) nếu sheet đang dùng layout 8 cột cũ.

    Nếu bạn đã thêm tay cột Thu/Chi đúng vị trí C: chỉ chuẩn hóa tiêu đề C1, không ghi đè dữ liệu.
    """
    try:
        values = sheet.get_all_values()
        if not values:
            return
        header = values[0]
        inserted_column = False

        # Đã có đủ 8+ cột và cột C là Thu/Chi (tên linh hoạt), D là Phương thức → coi là OK.
        if (
            len(header) >= 8
            and _is_thu_chi_header(header[2])
            and _is_payment_method_header(header[3])
        ):
            if str(header[2]).strip() != "Thu/Chi":
                sheet.update("C1", [["Thu/Chi"]], value_input_option="USER_ENTERED")
            return

        thu_idx = _find_thu_chi_col_index(header)
        if thu_idx is not None and thu_idx != 2:
            logger.warning(
                "Sheet Chi Tiêu: cột Thu/Chi đang ở %s (0-based=%s); chuẩn là cột C (index 2 sau Giờ). "
                "Di chuyển cột hoặc xuất/import lại cho khớp HEADERS trong code.",
                thu_idx + 1,
                thu_idx,
            )
            return

        if len(header) == 8 and len(header) > 2 and str(header[2]).strip() == "Phương thức":
            n = len(values)
            sheet.insert_cols([[""] * n], col=3)
            values = sheet.get_all_values()
            header = values[0]
            inserted_column = True
        elif len(header) < 8:
            logger.warning(
                "Sheet Chi Tiêu: bỏ qua migrate — cần ít nhất 8 cột (C=Thu/Chi, D=Phương thức) hoặc layout cũ 8 cột (C=Phương thức)."
            )
            return

        sheet.update("A1:H1", [HEADERS], value_input_option="USER_ENTERED")
        # Chỉ điền Thu/Chi + sửa Danh mục khi vừa chèn cột tự động (không đè tay user).
        if inserted_column and len(values) > 1:
            body_c = []
            body_e = []
            for ri in range(1, len(values)):
                row = values[ri]
                cat = row[4] if len(row) > 4 else ""
                cat_s = str(cat).strip()
                if cat_s == "Thu nhập":
                    body_c.append(["Thu"])
                    body_e.append(["Khác"])
                else:
                    body_c.append(["Chi"])
                    prev = row[4] if len(row) > 4 else "Khác"
                    body_e.append([prev if prev else "Khác"])
            sheet.update(f"C2:C{len(values)}", body_c, value_input_option="USER_ENTERED")
            sheet.update(f"E2:E{len(values)}", body_e, value_input_option="USER_ENTERED")
        sheet.format(
            "A1:H1",
            {
                "textFormat": {"bold": True},
                "backgroundColor": {"red": 0.2, "green": 0.6, "blue": 0.9},
            },
        )
    except Exception as e:
        logger.error("Không migrate schema sheet: %s", e)


class SheetsManager:
    def __init__(self, spreadsheet_id: str, credentials_file: str = "credentials.json"):
        self.spreadsheet_id = spreadsheet_id
        self.credentials_file = credentials_file
        self._client = None
        self._sheet = None
        self._init_lock = threading.Lock()
        self._payment_methods_cache: tuple[float, list[str]] | None = None
        self._payment_methods_ttl = 120.0

    def spreadsheet_tail_hint(self) -> str:
        """Đuôi Google Spreadsheet ID (đối chiếu nhầm file khi user không thấy dòng mới)."""
        s = str(self.spreadsheet_id or "").strip()
        if len(s) < 8:
            return ""
        return s[-10:]

    def _fetch_so_du_payment_methods_sync(self) -> list[str]:
        """Đọc cột A sheet So_Du; lỗi hoặc trống → DEFAULT_PAYMENT_METHODS."""
        try:
            client = self._get_client()
            spreadsheet = client.open_by_key(self.spreadsheet_id)
            ws = spreadsheet.worksheet(SO_DU_SHEET)
            col = ws.col_values(1)
        except Exception as e:
            logger.warning("Không đọc %s cột A: %s — dùng DEFAULT_PAYMENT_METHODS", SO_DU_SHEET, e)
            return list(DEFAULT_PAYMENT_METHODS)
        parsed = parse_so_du_column_a(col)
        return parsed if parsed else list(DEFAULT_PAYMENT_METHODS)

    async def get_allowed_payment_methods(self) -> list[str]:
        now = time.monotonic()
        if self._payment_methods_cache is not None:
            ts, methods = self._payment_methods_cache
            if now - ts < self._payment_methods_ttl:
                return methods
        methods = await asyncio.to_thread(self._fetch_so_du_payment_methods_sync)
        self._payment_methods_cache = (now, methods)
        return methods

    def _get_client(self):
        """Lấy Google Sheets client (lazy init, thread-safe)."""
        if self._client is not None:
            return self._client
        with self._init_lock:
            if self._client is not None:
                return self._client
            with open(self.credentials_file, encoding="utf-8") as f:
                info = json.load(f)
            creds = Credentials.from_service_account_info(info, scopes=SCOPES)
            self._client = gspread.authorize(creds)
            # Tránh hang vô hạn khi Google API chậm/timeout (gây "Resource deadlock avoided" trên macOS)
            self._client.set_timeout(20)
        return self._client

    def _get_sheet(self):
        """Lấy worksheet, tạo mới nếu chưa có (thread-safe).

        Phải gọi _get_client() TRƯỚC khi giữ lock — tránh nested lock deadlock
        (trước đây gây lỗi macOS 'Resource deadlock avoided').
        """
        if self._sheet is not None:
            return self._sheet
        client = self._get_client()
        with self._init_lock:
            if self._sheet is not None:
                return self._sheet
            spreadsheet = client.open_by_key(self.spreadsheet_id)

            try:
                self._sheet = spreadsheet.worksheet(SHEET_NAME)
            except gspread.WorksheetNotFound:
                self._sheet = spreadsheet.add_worksheet(
                    title=SHEET_NAME, rows=10000, cols=len(HEADERS)
                )
                self._sheet.append_row(HEADERS)
                self._sheet.format(
                    "A1:H1",
                    {
                        "textFormat": {"bold": True},
                        "backgroundColor": {"red": 0.2, "green": 0.6, "blue": 0.9},
                    },
                )
                logger.info(f"Đã tạo sheet mới: {SHEET_NAME}")
            else:
                _ensure_sheet_schema(self._sheet)
            _ensure_ngay_column_date_format(self._sheet)

        return self._sheet

    async def append_row(self, data: dict) -> Tuple[bool, Optional[str]]:
        """Thêm một dòng chi tiêu vào sheet. Trả về (True, None) hoặc (False, thông báo lỗi)."""
        try:
            allowed = await self.get_allowed_payment_methods()
            raw_pm = data.get("payment_method", "Tiền mặt")
            bank_hint = str(data.pop("bank_hint", "") or "").strip() or None
            pm_ok, pm_err = resolve_payment_method(str(raw_pm), allowed, bank_hint=bank_hint)
            if pm_err:
                logger.error("%s", pm_err)
                return False, pm_err
            data["payment_method"] = pm_ok

            sheet = await asyncio.to_thread(self._get_sheet)
            thu_chi = str(data.get("thu_chi", "Chi")).strip()
            if thu_chi not in ("Thu", "Chi"):
                thu_chi = "Chi"
            if "time" in data:
                time_cell = "" if data.get("time") is None else str(data.get("time")).strip()
            else:
                time_cell = datetime.now().strftime("%H:%M")
            date_serial = _coerce_input_date_to_serial(data.get("date"))
            d_show = (_SHEETS_DATE_ORIGIN + timedelta(days=date_serial)).strftime("%d/%m/%Y")
            amt = int(data.get("amount", 0) or 0)
            skip_dedup = os.environ.get("BOT_MONEY_SKIP_DEDUP", "").strip().lower() in (
                "1",
                "true",
                "yes",
            )
            if not skip_dedup:
                records = await asyncio.to_thread(sheet.get_all_records)
                dup_msg = _find_recent_duplicate_row(
                    d_show,
                    thu_chi,
                    amt,
                    str(data.get("description", "") or ""),
                    str(data.get("note", "") or ""),
                    records,
                )
                if dup_msg:
                    logger.warning("%s", dup_msg)
                    return False, dup_msg

            row = [
                date_serial,
                time_cell,
                thu_chi,
                data.get("payment_method", "Tiền mặt"),
                data.get("category", "Khác"),
                data.get("description", ""),
                data.get("amount", 0),
                data.get("note", ""),
            ]
            await asyncio.to_thread(
                lambda: sheet.append_row(row, value_input_option="RAW"),
            )
            logger.info("Đã thêm dòng: Ngày=%s (serial=%s) ...", d_show, date_serial)
            return True, None
        except Exception as e:
            logger.error(f"Lỗi append row: {e}")
            return False, str(e)

    async def delete_last_row(self) -> bool:
        """Xóa dòng cuối cùng (giao dịch vừa thêm)"""
        try:
            sheet = await asyncio.to_thread(self._get_sheet)
            all_values = await asyncio.to_thread(sheet.get_all_values)
            last_row = len(all_values)
            if last_row > 1:  # Giữ lại header
                await asyncio.to_thread(sheet.delete_rows, last_row)
                return True
            return False
        except Exception as e:
            logger.error(f"Lỗi delete row: {e}")
            return False

    async def get_expenses_by_date(self, date_str: str) -> list:
        """Lấy chi tiêu theo ngày (dd/mm/yyyy)"""
        try:
            sheet = await asyncio.to_thread(self._get_sheet)
            all_data = await asyncio.to_thread(sheet.get_all_records)
            return [
                row
                for row in all_data
                if _parse_ngay_cell_to_dd_mm_yyyy(row.get("Ngày")) == date_str
            ]
        except Exception as e:
            logger.error(f"Lỗi get by date: {e}")
            return []

    async def get_expenses_by_month(self, month_str: str) -> list:
        """Lấy chi tiêu theo tháng (mm/yyyy)"""
        try:
            sheet = await asyncio.to_thread(self._get_sheet)
            all_data = await asyncio.to_thread(sheet.get_all_records)
            return [
                row
                for row in all_data
                if _parse_ngay_cell_to_dd_mm_yyyy(row.get("Ngày"))[3:].strip()
                == month_str
            ]
        except Exception as e:
            logger.error(f"Lỗi get by month: {e}")
            return []

    async def get_expenses_this_week(self) -> list:
        """Lấy chi tiêu tuần này"""
        try:
            sheet = await asyncio.to_thread(self._get_sheet)
            all_data = await asyncio.to_thread(sheet.get_all_records)

            today = datetime.now()
            week_start = today - timedelta(days=today.weekday())

            result = []
            for row in all_data:
                date_str = _parse_ngay_cell_to_dd_mm_yyyy(row.get("Ngày"))
                if not date_str:
                    continue
                try:
                    row_date = datetime.strptime(date_str, "%d/%m/%Y")
                    if row_date >= week_start:
                        result.append(row)
                except ValueError:
                    continue
            return result
        except Exception as e:
            logger.error(f"Lỗi get week: {e}")
            return []

    async def get_all_expenses(self) -> list:
        """Lấy toàn bộ chi tiêu"""
        try:
            sheet = await asyncio.to_thread(self._get_sheet)
            return await asyncio.to_thread(sheet.get_all_records)
        except Exception as e:
            logger.error(f"Lỗi get all: {e}")
            return []

    def normalize_records(self, records: list) -> list:
        """Chuẩn hóa dữ liệu từ sheet"""
        normalized = []
        for r in records:
            try:
                amount = _parse_vnd_amount(r.get("Số tiền (VND)", "0"))
                normalized.append({
                    "date": _parse_ngay_cell_to_dd_mm_yyyy(r.get("Ngày"))
                    or str(r.get("Ngày", "")),
                    "time": r.get("Giờ", ""),
                    "thu_chi": _record_thu_chi_value(r),
                    "payment_method": r.get("Phương thức", ""),
                    "category": r.get("Danh mục", ""),
                    "description": r.get("Mô tả", ""),
                    "amount": amount,
                    "note": r.get("Ghi chú", ""),
                })
            except Exception:
                continue
        return normalized

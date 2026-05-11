"""Danh sách Phương thức: ưu tiên sheet So_Du cột A; chuẩn hóa & alias trước khi ghi Chi Tiêu."""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

# Dùng khi chưa đọc được So_Du hoặc cột A trống (giữ khớp yêu cầu user).
DEFAULT_PAYMENT_METHODS: tuple[str, ...] = (
    "Techcombank",
    "Techcombank credit",
    "Vietcombank",
    "Vietcombank credit",
    "Vpbank",
    "Standard",
    "Standard credit",
    "Momo",
    "Tiền mặt",
    "Vpbank vợ",
    "Tech vợ",
    "VCB vợ",
)

# Tiêu đề / nhãn hay gặp ở dòng đầu cột A — bỏ qua.
_SKIP_HEADER_NORMALIZED = frozenset(
    {
        "phuong thuc",
        "phương thức",
        "loai",
        "loại",
        "ten",
        "tên",
        "stt",
        "danh sach",
        "danh sách",
        "#",
        "no",
    }
)


def normalize_payment_key(s: str) -> str:
    s = unicodedata.normalize("NFKC", (s or "").strip())
    s = s.lower()
    s = re.sub(r"\s+", " ", s)
    return s


def _build_canonical_index(allowed: list[str]) -> dict[str, str]:
    """normalized -> chuỗi đúng như trên sheet (canonical)."""
    idx: dict[str, str] = {}
    for a in allowed:
        if not (a or "").strip():
            continue
        canon = a.strip()
        idx[normalize_payment_key(canon)] = canon
    return idx


def _strip_ck_prefix(n: str) -> str:
    if n.startswith("ck "):
        return n[3:].strip()
    if n.startswith("chuyen khoan ") or n.startswith("chuyển khoản "):
        return n.split(" ", 2)[-1].strip()
    return n


def _is_napas_or_fast_transfer_label(n: str) -> bool:
    """Nhãn kiểu 'Chuyển nhanh Napas 247' trên app NH — không phải tên cột So_Du."""
    if "napas" in n:
        return True
    if "247" in n and "nhanh" in n:
        return True
    if "chuyen nhanh" in n or "chuyển nhanh" in n:
        return True
    return False


def _map_napas_channel_to_canonical(raw: str, bank_hint: str | None, allowed_set: frozenset[str]) -> Optional[str]:
    """Chọn Techcombank / Vpbank / Vietcombank từ bank_name trên biên lai."""
    n = normalize_payment_key(raw)
    if not _is_napas_or_fast_transfer_label(n):
        return None
    bh = normalize_payment_key(bank_hint or "")
    order: list[str] = []
    if "vpbank" in bh or "vp bank" in bh or bh == "neo" or bh.endswith(" neo") or "neo" in bh and "vp" in bh:
        order.extend(["Vpbank", "Techcombank", "Vietcombank"])
    elif "techcombank" in bh or "techcom" in bh:
        order.extend(["Techcombank", "Vpbank", "Vietcombank"])
    elif "vietcombank" in bh or "vcb" in bh or "vietinbank" in bh:
        order.extend(["Vietcombank", "Techcombank", "Vpbank"])
    else:
        order.extend(["Techcombank", "Vpbank", "Vietcombank"])
    for cand in order:
        if cand in allowed_set:
            return cand
    return None


def resolve_payment_method(
    raw: str | None,
    allowed: list[str],
    *,
    bank_hint: str | None = None,
) -> tuple[Optional[str], Optional[str]]:
    """
    Trả về (canonical, None) nếu hợp lệ; (None, message lỗi) nếu không khớp.

    bank_hint: tên NH trên biên lai (vd Techcombank, VPBank) — dùng map Napas 247 / chuyển nhanh.
    """
    if not allowed:
        allowed = list(DEFAULT_PAYMENT_METHODS)

    allowed_set = frozenset(a.strip() for a in allowed if (a or "").strip())
    idx = _build_canonical_index(list(allowed_set))

    s0 = (raw or "").strip()
    if not s0:
        if "Tiền mặt" in allowed_set:
            return "Tiền mặt", None
        return None, "payment_method trống; cần một trong danh sách So_Du (cột A)."

    if s0 in allowed_set:
        return s0, None

    n = normalize_payment_key(s0)
    if n in idx:
        return idx[n], None

    napas_canon = _map_napas_channel_to_canonical(s0, bank_hint, allowed_set)
    if napas_canon:
        return napas_canon, None

    # Ví điện tử / MoMo (output cũ từ analyzer)
    if "momo" in n:
        if "Momo" in allowed_set:
            return "Momo", None

    n2 = _strip_ck_prefix(n)
    if n2 != n and n2 in idx:
        return idx[n2], None

    # Thẻ / credit: ưu tiên biến thể * credit nếu có trong allowed
    has_credit = (
        "credit" in n
        or "thẻ" in n
        or re.search(r"\bthe\b", n) is not None
        or "card" in n
    )
    has_vo = "vợ" in n or n.endswith(" vo") or " vo " in n

    def pick_credit(base_plain: str, credit_label: str, plain_label: str) -> Optional[str]:
        if has_credit and credit_label in allowed_set:
            return credit_label
        if base_plain in n or base_plain in n2:
            if plain_label in allowed_set:
                return plain_label
        return None

    if not has_vo:
        for base, plain, credit in (
            ("techcombank", "Techcombank", "Techcombank credit"),
            ("vietcombank", "Vietcombank", "Vietcombank credit"),
            ("vpbank", "Vpbank", "Vpbank"),  # không có Vpbank credit trong list user
            ("standard", "Standard", "Standard credit"),
        ):
            got = pick_credit(base, credit, plain)
            if got:
                return got, None

    # VCB: có "vợ" -> VCB vợ; không -> Vietcombank / Vietcombank credit
    if "vcb" in n or "vietcombank" in n or "vietinbank" in n:
        if has_vo and "VCB vợ" in allowed_set:
            return "VCB vợ", None
        if has_credit and "Vietcombank credit" in allowed_set:
            return "Vietcombank credit", None
        if "Vietcombank" in allowed_set:
            return "Vietcombank", None

    if has_vo:
        if ("tech" in n or "techcombank" in n) and "Tech vợ" in allowed_set:
            return "Tech vợ", None
        if "vpbank" in n and "Vpbank vợ" in allowed_set:
            return "Vpbank vợ", None

    # Chuỗi chỉ là ngân hàng (sau CK)
    for key, canon in (
        ("techcombank", "Techcombank"),
        ("vietcombank", "Vietcombank"),
        ("vpbank", "Vpbank"),
        ("standard chartered", "Standard"),
        ("standard", "Standard"),
    ):
        if key in n or key in n2:
            if canon in allowed_set:
                return canon, None

    allowed_txt = ", ".join(sorted(allowed_set))
    return None, f"Phương thức {s0!r} không hợp lệ. Chỉ dùng một mục trong So_Du (cột A): {allowed_txt}"


def parse_so_du_column_a(values: list[str]) -> list[str]:
    """values: cột A từ sheet So_Du (theo thứ tự)."""
    out: list[str] = []
    seen: set[str] = set()
    for i, cell in enumerate(values):
        s = str(cell).strip()
        if not s:
            continue
        nk = normalize_payment_key(s)
        if i == 0 and nk in _SKIP_HEADER_NORMALIZED:
            continue
        if nk in _SKIP_HEADER_NORMALIZED and len(s) < 24:
            continue
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out

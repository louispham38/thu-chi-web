"""
Vietnamese expense text parser.

Parses natural-language messages like the Telegram Bot does, e.g.:
  "ăn sáng 50k tiền mặt"
  "thu lương 15tr techcombank"
  "mua sắm quần áo 320k vcb chi"
  "đổ xăng 150,000 vpbank"
  "bảo hiểm y tế 500k tiền mặt chi"
"""
from __future__ import annotations

import re
from difflib import get_close_matches
from typing import Optional


# ── Number parsing ────────────────────────────────────────────────────────────

_NUM_RE = re.compile(
    r"""
    (?:^|(?<=\s)|(?<=[,.:]))        # word boundary
    (\d[\d.,]*)                      # digits
    \s*                              # optional space
    (tr(?:iệu)?|k|nghìn|đồng|vnd)?  # optional unit
    (?=\s|$|[,.:!?)])               # followed by space/end/punct
    """,
    re.IGNORECASE | re.VERBOSE,
)

def parse_amount(text: str) -> Optional[int]:
    """Extract the first reasonable monetary amount from text."""
    best: Optional[int] = None
    for m in _NUM_RE.finditer(text):
        raw = m.group(1).replace(",", "").replace(".", "")
        unit = (m.group(2) or "").lower()
        try:
            n = float(raw)
        except ValueError:
            continue

        if unit in ("tr", "triệu"):
            n *= 1_000_000
        elif unit in ("k", "nghìn"):
            n *= 1_000

        n = int(n)
        if n <= 0:
            continue
        # prefer the largest reasonable number (not > 1 billion)
        if n > 1_000_000_000:
            continue
        if best is None or n > best:
            best = n
    return best


# ── Thu / Chi detection ───────────────────────────────────────────────────────

_THU_KEYWORDS = [
    "thu", "nhận", "được trả", "lương", "thưởng", "hoàn tiền", "refund",
    "hoàn", "nhận tiền", "nhận lương", "được", "income",
]
_CHI_KEYWORDS = [
    "chi", "trả", "mua", "ăn", "uống", "đổ", "nạp", "thanh toán",
    "trả tiền", "trả góp", "đặt cọc", "cọc", "phí", "hóa đơn",
    "bill", "pay", "payment", "transfer", "chuyển khoản", "expense",
]

def detect_thu_chi(text: str) -> str:
    """Return 'Thu' or 'Chi' based on keyword heuristics."""
    t = text.lower()

    # Explicit override: "thu" or "chi" as standalone word
    if re.search(r'\bthu\b', t):
        # make sure it's not "thứ" or "thuốc" etc.
        # check context: "thu nhập", "thu lương", "thu tiền"
        if re.search(r'\bthu\s*(nhập|lương|tiền|thêm|được|nhận|nhận lại)\b', t):
            return "Thu"
        # bare "thu" at end or in phrase → likely Thu
        if re.search(r'\bthu\b', t):
            return "Thu"
    if re.search(r'\bchi\b', t):
        return "Chi"

    # Keyword scoring
    thu_score = sum(1 for kw in _THU_KEYWORDS if kw in t)
    chi_score = sum(1 for kw in _CHI_KEYWORDS if kw in t)

    if thu_score > chi_score:
        return "Thu"
    return "Chi"  # default


# ── Category detection ────────────────────────────────────────────────────────

_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Ăn uống": [
        "ăn", "uống", "sáng", "trưa", "tối", "cafe", "cà phê", "coffee",
        "bún", "phở", "cơm", "bánh", "pizza", "burger", "trà sữa",
        "nhậu", "bia", "rượu", "snack", "ăn vặt", "đồ ăn", "food",
    ],
    "Xăng xe": [
        "xăng", "đổ xăng", "nhiên liệu", "gas", "petrol",
    ],
    "Di chuyển": [
        "grab", "taxi", "xe ôm", "bus", "tàu", "vé tàu", "vé xe",
        "xe buýt", "uber", "gojek", "be", "di chuyển", "đi lại",
        "vé máy bay", "bay", "chuyến bay",
    ],
    "Mua sắm": [
        "mua", "mua sắm", "quần áo", "giày", "túi", "shopping",
        "shopee", "lazada", "tiki", "điện thoại", "laptop", "máy tính",
        "đồ dùng", "đồ gia dụng", "thiết bị",
    ],
    "Học hành": [
        "học", "khóa học", "trường", "sách", "tài liệu", "course",
        "tutor", "gia sư", "học phí", "học online", "udemy",
    ],
    "Sức khỏe": [
        "thuốc", "bệnh viện", "khám", "y tế", "bảo hiểm y tế",
        "phòng khám", "nha khoa", "gym", "tập gym", "thể thao",
        "health", "medical",
    ],
    "Hóa đơn": [
        "điện", "nước", "internet", "điện thoại", "viễn thông",
        "hóa đơn", "bill", "tiền điện", "tiền nước", "wifi",
    ],
    "Nhà cửa": [
        "nhà", "thuê nhà", "tiền nhà", "rent", "sửa nhà", "nội thất",
        "điều hòa", "tủ lạnh", "máy giặt",
    ],
    "Giải trí": [
        "giải trí", "phim", "cinema", "cgv", "lotte", "game",
        "concert", "event", "du lịch", "travel", "nghỉ dưỡng",
        "resort", "khách sạn", "hotel",
    ],
    "Khác": [],
}


def detect_category(text: str, categories: Optional[list[str]] = None) -> str:
    """Detect expense category from text."""
    t = text.lower()
    scores: dict[str, int] = {}
    for cat, keywords in _CATEGORY_KEYWORDS.items():
        s = sum(1 for kw in keywords if kw in t)
        if s > 0:
            scores[cat] = s

    if not scores:
        return "Khác"

    best = max(scores, key=lambda k: scores[k])

    # If caller provided allowed category list, validate
    if categories and best not in categories:
        matches = get_close_matches(best, categories, n=1, cutoff=0.6)
        return matches[0] if matches else (categories[0] if categories else "Khác")

    return best


# ── Payment method detection ──────────────────────────────────────────────────

def detect_payment_method(text: str, payment_methods: list[str]) -> Optional[str]:
    """Detect which payment account is mentioned in text."""
    t = text.lower()

    # Exact / partial match against known accounts
    for pm in payment_methods:
        if pm.lower() in ("sum=", "nguồn", "nguon"):
            continue
        if pm.lower() in t:
            return pm

    # Alias mapping
    aliases: dict[str, str] = {
        "vcb": "Vietcombank",
        "vietcombank": "Vietcombank",
        "tcb": "Techcombank",
        "techcombank": "Techcombank",
        "vpb": "Vpbank",
        "vpbank": "Vpbank",
        "momo": "Momo",
        "tiền mặt": "Tiền mặt",
        "cash": "Tiền mặt",
        "tm": "Tiền mặt",
    }
    for alias, canonical in aliases.items():
        if alias in t:
            # find canonical in payment_methods (case-insensitive)
            for pm in payment_methods:
                if pm.lower() == canonical.lower() or canonical.lower() in pm.lower():
                    return pm

    return None


# ── Description extraction ────────────────────────────────────────────────────

_STRIP_PATTERNS = [
    # amounts with units
    re.compile(r'\d[\d.,]*\s*(?:tr(?:iệu)?|k|nghìn|đồng|vnd)', re.IGNORECASE),
    # bare numbers ≥ 4 digits
    re.compile(r'\b\d{4,}\b'),
    # standalone thu/chi
    re.compile(r'\b(?:thu|chi)\b', re.IGNORECASE),
]


def extract_description(text: str, payment_method: Optional[str]) -> str:
    """Return cleaned description after removing amount, account, thu/chi tokens."""
    s = text
    for pat in _STRIP_PATTERNS:
        s = pat.sub("", s)
    # Remove payment method name
    if payment_method:
        s = re.sub(re.escape(payment_method), "", s, flags=re.IGNORECASE)
        # Also remove aliases
        for alias in ("vcb", "tcb", "vpb"):
            s = re.sub(r'\b' + alias + r'\b', "", s, flags=re.IGNORECASE)
    # Clean up whitespace
    s = re.sub(r'\s+', ' ', s).strip(" ,.-:")
    return s or text.strip()


# ── Main parse function ───────────────────────────────────────────────────────

def parse_expense(
    text: str,
    payment_methods: Optional[list[str]] = None,
    categories: Optional[list[str]] = None,
) -> dict:
    """
    Parse a Vietnamese expense message into structured fields.

    Returns a dict with keys:
        amount, thu_chi, category, payment_method, description, confidence
    """
    pm_list = payment_methods or []
    cat_list = categories or []

    amount = parse_amount(text)
    thu_chi = detect_thu_chi(text)
    category = detect_category(text, cat_list)
    payment_method = detect_payment_method(text, pm_list)
    description = extract_description(text, payment_method)

    # Confidence: high if we found amount + either category or payment method
    if amount and (category != "Khác" or payment_method):
        confidence = "high"
    elif amount:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "amount": amount or 0,
        "thu_chi": thu_chi,
        "category": category,
        "payment_method": payment_method or (pm_list[0] if pm_list else "Tiền mặt"),
        "description": description,
        "confidence": confidence,
    }

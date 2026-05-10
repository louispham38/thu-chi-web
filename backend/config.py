"""Cấu hình — không commit secret."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

HOME = Path.home()
DEFAULT_BOT_ROOT = HOME / ".openclaw" / "workspace" / "Bot_money"

_tmp_cred_path: str | None = None


def credentials_path() -> str:
    """
    Ưu tiên theo thứ tự:
    1. GOOGLE_CREDENTIALS_JSON (nội dung JSON, dùng khi deploy trên cloud)
    2. BOT_MONEY_CREDENTIALS (đường dẫn file)
    3. ~/.openclaw/workspace/Bot_money/credentials.json (mặc định local)
    """
    global _tmp_cred_path

    json_str = os.environ.get("GOOGLE_CREDENTIALS_JSON", "").strip()
    if json_str:
        # Parse một lần, lưu vào temp file tái sử dụng
        if _tmp_cred_path is None or not os.path.isfile(_tmp_cred_path):
            try:
                data = json.loads(json_str)
            except json.JSONDecodeError as e:
                raise RuntimeError(f"GOOGLE_CREDENTIALS_JSON không phải JSON hợp lệ: {e}") from e
            fd, path = tempfile.mkstemp(prefix="thu_chi_cred_", suffix=".json")
            with os.fdopen(fd, "w") as f:
                json.dump(data, f)
            _tmp_cred_path = path
        return _tmp_cred_path

    return os.environ.get(
        "BOT_MONEY_CREDENTIALS",
        str(DEFAULT_BOT_ROOT / "credentials.json"),
    )


def spreadsheet_id() -> str:
    sid = os.environ.get("GOOGLE_SPREADSHEET_ID", "").strip()
    if sid:
        return sid
    local = DEFAULT_BOT_ROOT / "openclaw_local.json"
    if local.is_file():
        try:
            data = json.loads(local.read_text(encoding="utf-8"))
            x = data.get("GOOGLE_SPREADSHEET_ID") or data.get("google_spreadsheet_id")
            if x and str(x).strip():
                return str(x).strip()
        except (OSError, json.JSONDecodeError):
            pass
    raise RuntimeError(
        "Thiếu GOOGLE_SPREADSHEET_ID — set env var hoặc tạo ~/.openclaw/workspace/Bot_money/openclaw_local.json",
    )


def api_key() -> str | None:
    """Nếu đặt THU_CHI_WEB_API_KEY thì mọi request phải có header X-API-Key."""
    v = os.environ.get("THU_CHI_WEB_API_KEY", "").strip()
    return v or None


def cors_origins() -> list[str]:
    raw = os.environ.get("THU_CHI_WEB_CORS", "")
    if raw.strip():
        return [x.strip() for x in raw.split(",") if x.strip()]
    return ["*"]  # open by default khi deploy; khoá lại bằng env var

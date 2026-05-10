#!/usr/bin/env bash
# Thu/Chi Web — chạy production (chỉ backend, phục vụ cả UI tại :8000)
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"

# Build frontend nếu chưa có dist
if [[ ! -f "$FRONTEND_DIR/dist/index.html" ]]; then
  echo "→ Build frontend…"
  (cd "$FRONTEND_DIR" && npm install --silent && npm run build)
fi

# Đảm bảo venv tồn tại
if [[ ! -f "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
  echo "→ Tạo venv Python 3.11…"
  /opt/homebrew/opt/python@3.11/bin/python3.11 -m venv "$BACKEND_DIR/.venv"
  "$BACKEND_DIR/.venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
fi

echo "→ Khởi động http://127.0.0.1:8000"
exec "$BACKEND_DIR/.venv/bin/uvicorn" main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --app-dir "$BACKEND_DIR"

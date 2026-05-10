#!/usr/bin/env bash
# Thu/Chi Web — khởi động backend + frontend dev
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"

# ── Đảm bảo venv tồn tại ──────────────────────────────────────────────────────
if [[ ! -f "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
  echo "→ Tạo venv Python 3.11 cho backend…"
  /opt/homebrew/opt/python@3.11/bin/python3.11 -m venv "$BACKEND_DIR/.venv"
  "$BACKEND_DIR/.venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
fi

# ── Đảm bảo node_modules tồn tại ─────────────────────────────────────────────
if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "→ Cài npm packages…"
  (cd "$FRONTEND_DIR" && npm install --silent)
fi

# ── Khởi động Backend ─────────────────────────────────────────────────────────
echo "→ Backend   http://127.0.0.1:8000"
"$BACKEND_DIR/.venv/bin/uvicorn" main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --reload \
  --app-dir "$BACKEND_DIR" &
BACKEND_PID=$!

# ── Khởi động Frontend dev ────────────────────────────────────────────────────
echo "→ Frontend  http://127.0.0.1:5173  (proxy /api → :8000)"
(cd "$FRONTEND_DIR" && npm run dev -- --port 5173) &
FRONTEND_PID=$!

# ── Dọn dẹp khi thoát ────────────────────────────────────────────────────────
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM

echo ""
echo "  Thu/Chi đang chạy:"
echo "  • Dev UI  → http://127.0.0.1:5173"
echo "  • API     → http://127.0.0.1:8000/api/health"
echo ""
echo "  Nhấn Ctrl+C để thoát."
wait

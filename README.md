# Thu / Chi Web

Ứng dụng web quản lý thu/chi cá nhân — đồng bộ thẳng vào Google Sheet.
Hỗ trợ **multi-tenant** (mỗi user một Sheet riêng trong Drive của họ qua Google OAuth)
và **legacy single-tenant** (một Sheet dùng chung với OpenClaw Telegram Bot).

## Tính năng

| Trang | Mô tả |
|-------|-------|
| **Landing (`/`)** | Marketing + nút đăng ký |
| **Login (`/login`)** | Đăng nhập bằng Google |
| **Onboarding (`/onboarding`)** | Tạo Sheet mới hoặc adopt Sheet đã có |
| **Dashboard** | Tổng thu/chi tháng + biểu đồ + giao dịch |
| **Nhập Thu/Chi** | Chat tự nhiên (parser tiếng Việt) → Sheet |
| **Cash flow** | Thu/chi theo ngày (tuần / tháng / tùy chỉnh) |
| **Tài khoản** | Số dư đầu kỳ + hiện có (sheet `So_Du`) |
| **Kế hoạch quỹ** | Phân bổ thu nhập 7 quỹ (sheet `Ke_Hoach_Quy`) |

## Modes

App tự nhận diện mode theo env var:

- **Multi-tenant** (khi có `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `FERNET_KEY`):
  user phải đăng nhập, mỗi người một workspace + sheet riêng.
- **Legacy** (chỉ có `GOOGLE_SPREADSHEET_ID` + `GOOGLE_CREDENTIALS_JSON`): không cần đăng nhập,
  toàn bộ traffic đổ vào sheet duy nhất (giữ Bot Telegram chạy như cũ).

---

## Setup multi-tenant (production trên Render)

### 1. Google Cloud Console

Bật **Google Sheets API** + **Google Drive API** trong project hiện có
(`cogent-wall-327100`).

**Tạo OAuth Client (Web):**

1. APIs & Services → **Credentials** → Create Credentials → **OAuth client ID**
2. Application type: **Web application**
3. **Authorized redirect URIs:**
   - `http://127.0.0.1:8000/auth/callback` (dev)
   - `https://thu-chi-web.onrender.com/auth/callback` (prod)
4. Lưu `Client ID` và `Client Secret`

**OAuth consent screen:**
- User type: External (testing đầu tiên)
- Scopes: `openid`, `email`, `profile`,
  `https://www.googleapis.com/auth/spreadsheets`,
  `https://www.googleapis.com/auth/drive.file`
- Test users: thêm email của bạn (hoặc publish app khi muốn mở rộng)

### 2. Sinh key mã hoá refresh token

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Lưu kết quả lại — sẽ paste vào env var `FERNET_KEY` trên Render.

### 3. Cấu hình Render

Render sẽ tự đọc `render.yaml`. Nhập tay các env vars sau (sync: false):

| Env var | Giá trị |
|---------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` | từ bước 1 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | từ bước 1 |
| `FERNET_KEY` | từ bước 2 |
| `PUBLIC_BASE_URL` | `https://thu-chi-web.onrender.com` |
| `GOOGLE_SPREADSHEET_ID` | (legacy — giữ nếu muốn fallback cho Bot) |
| `GOOGLE_CREDENTIALS_JSON` | (legacy — service account JSON) |

`JWT_SECRET` Render tự sinh (`generateValue: true`).
`DATABASE_URL` Render tự inject từ Postgres database `thu-chi-db`.

### 4. Deploy

Push lên `main` → Render auto-deploy. Lần đầu sẽ:

1. Tạo Postgres `thu-chi-db` (free 256MB)
2. Build frontend + cài Python deps
3. `init_db()` tự tạo các bảng `users / workspaces / memberships / invites`

---

## Local dev

### Backend

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Tạo .env (xem .env.example)
export GOOGLE_OAUTH_CLIENT_ID="..."
export GOOGLE_OAUTH_CLIENT_SECRET="..."
export FERNET_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
export JWT_SECRET="dev-secret"
export PUBLIC_BASE_URL="http://127.0.0.1:8000"
# DATABASE_URL bỏ trống → SQLite tại backend/thu_chi.db
# GOOGLE_SPREADSHEET_ID bỏ trống → tắt legacy mode
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend (dev)

```bash
cd frontend
npm install
npm run dev   # → http://127.0.0.1:5173 (proxy /api và /auth → :8000)
```

> **Lưu ý**: vite dev server cần cookie cross-origin? Không — `proxy` của vite
> đã chuyển tiếp `/auth` và `/api` về cùng origin `:8000` ở phía proxy, nên cookie `SameSite=Lax` hoạt động bình thường.

### Production build (1 port)

```bash
cd frontend && npm run build
cd ../backend && uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir .
```

---

## Cấu trúc

```
thu-chi-web/
├── backend/
│   ├── main.py              # FastAPI routes (tenant-aware)
│   ├── auth.py              # Google OAuth + JWT cookie + Fernet
│   ├── routes_auth.py       # /auth/* + /api/me + /api/onboarding/*
│   ├── tenant.py            # Tenant resolver (user/legacy)
│   ├── tenant_ops.py        # Wrapper: user_sheet vs sheet_client
│   ├── user_sheet.py        # Per-user OAuth Sheet ops
│   ├── sheet_client.py      # Legacy service-account ops
│   ├── db.py + models.py    # SQLAlchemy: users/workspaces/memberships/invites
│   ├── parser.py            # NLP parser tiếng Việt
│   └── config.py            # env vars
├── frontend/
│   ├── src/
│   │   ├── main.tsx         # Router shell + auth guards
│   │   ├── auth.tsx         # AuthContext, useAuth
│   │   ├── App.tsx          # main app (gated by /app/*)
│   │   ├── pages/
│   │   │   ├── Landing.tsx
│   │   │   ├── Login.tsx
│   │   │   └── Onboarding.tsx
│   │   ├── components/
│   │   │   └── UserMenu.tsx
│   │   └── styles.css
│   └── package.json
├── render.yaml              # Render deploy + Postgres
├── build.sh
└── README.md
```

---

## Status

- ✅ **Phase 1**: Landing + Google OAuth + per-user Sheet creation + workspace switcher
- ⏳ **Phase 2** (chưa làm): trang Profile, mời thành viên qua email, quản lý workspace, xoá account

## API endpoints (mới)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/auth/status` | `{enabled: bool}` — frontend biết server có OAuth không |
| GET | `/auth/login?next=/app` | Redirect → Google consent |
| GET | `/auth/callback` | OAuth callback — set cookie + redirect |
| POST | `/auth/logout` | Xoá session cookie |
| GET | `/api/me` | Thông tin user + workspaces |
| POST | `/api/onboarding/create-workspace` | Tạo Sheet mới + workspace |
| POST | `/api/onboarding/adopt-sheet` | Dùng Sheet ID đã có |

Các endpoint cũ (`/api/transactions`, `/api/cashflow`, …) tự động chọn sheet
theo session cookie + `X-Workspace-Id` header.

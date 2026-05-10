# Thu / Chi Web

Ứng dụng web quản lý thu/chi dùng **cùng Google Sheet** với OpenClaw Telegram Bot.

## Tính năng

| Tab | Mô tả |
|-----|-------|
| **Dashboard** | Tổng thu/chi/chênh lệch tháng, biểu đồ chi theo danh mục, biểu đồ 6 tháng, bảng giao dịch trong tháng |
| **Nhập Thu/Chi** | Form nhập giao dịch mới → ghi thẳng vào Google Sheet |
| **Tài khoản** | Danh sách phương thức thanh toán (lấy từ sheet So_Du) |
| **Kế hoạch quỹ** | Phân bổ thu nhập vào 7 quỹ, lưu vào sheet Ke_Hoach_Quy |

## Cách chạy nhanh

### Dev mode (backend + frontend riêng)

```bash
cd thu-chi-web
bash start.sh
```

- Frontend: http://127.0.0.1:5173
- Backend API: http://127.0.0.1:8000

### Production mode (chỉ chạy 1 port)

```bash
cd thu-chi-web
bash start-prod.sh
```

Mở http://127.0.0.1:8000

---

## Cài đặt thủ công

### Backend

```bash
cd backend
/opt/homebrew/opt/python@3.11/bin/python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend (dev)

```bash
cd frontend
npm install
npm run dev
```

### Frontend (production build)

```bash
cd frontend
npm run build   # → frontend/dist/
```

Sau khi build, chạy backend là đủ — UI được phục vụ tại `http://127.0.0.1:8000`.

---

## Cấu hình (không bắt buộc)

| Biến môi trường | Mô tả |
|-----------------|-------|
| `GOOGLE_SPREADSHEET_ID` | Ghi đè spreadsheet ID |
| `BOT_MONEY_CREDENTIALS` | Đường dẫn credentials JSON |
| `THU_CHI_WEB_API_KEY` | Bật xác thực X-API-Key cho tất cả `/api/*` |
| `THU_CHI_WEB_CORS` | Whitelist origins, phân cách dấu phẩy |

Mặc định backend tự đọc từ `~/.openclaw/workspace/Bot_money/openclaw_local.json` và
`~/.openclaw/workspace/Bot_money/credentials.json` — giống hệt config Bot Telegram.

---

## API endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/health` | Kiểm tra kết nối |
| GET | `/api/meta` | Danh mục, quỹ, tên sheet |
| GET | `/api/transactions` | Tất cả giao dịch |
| POST | `/api/transactions` | Thêm giao dịch |
| GET | `/api/summary?month=MM/YYYY` | Tổng kết tháng |
| GET | `/api/summary/range?months_back=6` | So sánh nhiều tháng |
| GET | `/api/accounts` | Phương thức thanh toán |
| GET | `/api/planning?month=MM/YYYY` | Kế hoạch phân bổ |
| POST | `/api/planning` | Lưu kế hoạch phân bổ |

## Cấu trúc thư mục

```
thu-chi-web/
├── backend/
│   ├── main.py          # FastAPI app
│   ├── sheet_client.py  # Google Sheets wrapper
│   ├── config.py        # Đọc credentials & env vars
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx      # UI chính
│   │   ├── api.ts       # Fetch wrapper
│   │   └── styles.css   # Dark theme
│   └── package.json
├── start.sh             # Chạy dev mode
└── start-prod.sh        # Chạy production
```

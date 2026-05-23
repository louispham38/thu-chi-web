# Deploy Thu Chi Web lên Fly.io

Thay thế Render Free (bị suspend khi hết 750 giờ/tháng). Fly.io cho phép **volume lưu SQLite** (user/workspace) và **auto wake** khi có request.

> **Lưu ý:** Fly yêu cầu **gắn thẻ** để đăng ký (chống abuse). Trong free tier thường **$0** nếu không vượt quota (3 VM nhỏ, 3GB volume).

---

## 0. Chuẩn bị (copy từ Render)

Trước khi Render tắt hẳn, mở Render Dashboard và copy các giá trị sau vào notepad:

| Biến | Lấy ở đâu |
|------|------------|
| `GOOGLE_OAUTH_CLIENT_ID` | Render → Environment |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Render → Environment |
| `FERNET_KEY` | Render → Environment (**quan trọng** — mất key = user phải login lại Google) |
| `JWT_SECRET` | Render → Environment |
| `GOOGLE_PICKER_API_KEY` | Render → Environment |
| `GOOGLE_SPREADSHEET_ID` | Legacy bot (tuỳ chọn) |
| `GOOGLE_CREDENTIALS_JSON` | Legacy service account JSON (tuỳ chọn) |

Postgres `thu-chi-db` trên Render **sẽ hết hạn 19/06/2026** nếu không upgrade. Trên Fly dùng **SQLite trên volume** — user đăng nhập Google lại và **reconnect sheet** qua Picker (xem bước 8).

---

## 1. Cài Fly CLI

**macOS:**

```bash
curl -L https://fly.io/install.sh | sh
```

Mở terminal mới:

```bash
fly version
```

## 2. Đăng nhập Fly

```bash
fly auth login
```

Hoặc `fly auth signup` nếu chưa có tài khoản.

---

## 3. Tạo app (lần đầu)

```bash
cd /Users/phamkhang/Documents/CursorAI/thu-chi-web
```

Nếu tên `thu-chi-web` đã bị chiếm trên Fly, sửa dòng `app = "..."` trong `fly.toml` rồi:

```bash
fly apps create thu-chi-web
# hoặc tên khác, khớp với fly.toml
```

---

## 4. Tạo volume (lưu SQLite + không mất khi redeploy)

```bash
fly volumes create thu_chi_data --region sin --size 1
```

Tên `thu_chi_data` phải khớp `source` trong `fly.toml` → `[[mounts]]`.

---

## 5. Đặt secrets (biến nhạy cảm)

Thay các giá trị `...` bằng giá trị thật từ Render / Google Cloud.

```bash
fly secrets set \
  PUBLIC_BASE_URL="https://thu-chi-web.fly.dev" \
  GOOGLE_OAUTH_CLIENT_ID="....apps.googleusercontent.com" \
  GOOGLE_OAUTH_CLIENT_SECRET="GOCSPX-..." \
  FERNET_KEY="..." \
  JWT_SECRET="..." \
  GOOGLE_PICKER_API_KEY="AIzaSy..."
```

**Legacy (Telegram bot / sheet cũ qua service account)** — chỉ nếu bạn vẫn cần:

```bash
fly secrets set \
  GOOGLE_SPREADSHEET_ID="1-MtrIgY..." \
  GOOGLE_CREDENTIALS_JSON='{"type":"service_account",...}'
```

(JSON một dòng; hoặc paste file: `fly secrets set GOOGLE_CREDENTIALS_JSON="$(cat credentials.json)"`)

Kiểm tra:

```bash
fly secrets list
```

> `DATABASE_URL` đã set trong `fly.toml` → `sqlite:////data/thu_chi.db` (không cần secret trừ khi bạn dùng Postgres ngoài).

---

## 6. Deploy

```bash
fly deploy
```

Lần đầu ~5–8 phút (build frontend + Python image).

```bash
fly status
fly logs
curl -s https://thu-chi-web.fly.dev/ping
curl -s https://thu-chi-web.fly.dev/api/health
```

Kỳ vọng: `{"ok":true}` và `{"status":"ok","auth_enabled":"True"}`.

---

## 7. Cập nhật Google Cloud Console (bắt buộc)

Vào [Credentials](https://console.cloud.google.com/apis/credentials) → OAuth client **Web**:

**Authorized JavaScript origins** — thêm:

```
https://thu-chi-web.fly.dev
```

**Authorized redirect URIs** — thêm:

```
https://thu-chi-web.fly.dev/auth/callback
```

(Giữ URL Render cũ nếu vẫn dùng song song.)

**API key (Picker)** — nếu có restriction theo website, thêm:

```
https://thu-chi-web.fly.dev/*
```

---

## 8. Sau deploy — tài khoản của bạn

1. Mở https://thu-chi-web.fly.dev/ (Incognito nếu cache cũ).
2. **Đăng nhập Google** lại (DB SQLite mới = chưa có user cũ từ Render Postgres).
3. Onboarding:
   - **Tạo sheet mới**, hoặc
   - **Dùng sheet cũ** → **Chọn từ Drive** (Google Picker) → chọn đúng file `1-MtrIgY...`
4. Nếu đã có workspace nhưng lỗi đọc sheet: **Cài đặt workspace** → **Kết nối lại Drive (Google Picker)**.

Sheet Google trên Drive **không mất** — chỉ cần link lại qua Picker.

---

## 9. Custom domain (tuỳ chọn)

```bash
fly certs add thu-chi.yourdomain.com
```

Làm theo hướng dẫn DNS Fly in ra, rồi cập nhật `PUBLIC_BASE_URL` và Google OAuth URLs.

```bash
fly secrets set PUBLIC_BASE_URL="https://thu-chi.yourdomain.com"
```

---

## 10. Cập nhật code sau này

```bash
cd /Users/phamkhang/Documents/CursorAI/thu-chi-web
git pull
fly deploy
```

---

## Lệnh hữu ích

| Lệnh | Mô tả |
|------|--------|
| `fly logs` | Log realtime |
| `fly ssh console` | Vào máy ảo |
| `fly volumes list` | Xem volume |
| `fly secrets list` | Xem secrets (không hiện giá trị) |
| `fly scale memory 512` | Tăng RAM nếu OOM |
| `fly apps open` | Mở URL trên browser |

---

## Free tier & giới hạn

- VM **tự sleep** khi không traffic (~ vài chục giây cold start lần đầu).
- **256MB RAM** mặc định (free tier). Nếu crash/OOM: `fly scale memory 512`.
- **160GB** outbound/tháng (thường đủ cho app cá nhân).
- Volume **1GB** — đủ cho SQLite user/workspace.

Ping UptimeRobot mỗi 5 phút (tuỳ chọn, giảm cold start):

```
https://thu-chi-web.fly.dev/ping
```

---

## So sánh Render vs Fly (app này)

| | Render Free | Fly.io (hướng dẫn này) |
|--|-------------|-------------------------|
| DB user OAuth | Postgres (hết hạn 90 ngày) | SQLite volume (ổn định hơn) |
| Suspend | Hết 750h/tháng | Không suspend kiểu đó |
| Chi phí | $0 đến khi suspend | $0 trong quota + cần thẻ |
| URL | `*.onrender.com` | `*.fly.dev` |

---

## Troubleshooting

**Build fail `npm ci`:** Chạy local `cd frontend && npm ci && npm run build` để xem lỗi.

**`auth_enabled: False`:** Thiếu `GOOGLE_OAUTH_*` hoặc `FERNET_KEY` → `fly secrets set ...`

**OAuth `redirect_uri_mismatch`:** Chưa thêm `https://<app>.fly.dev/auth/callback` trên Google Console.

**Không đọc được sheet:** Workspace Settings → **Kết nối lại Drive** + Picker.

**OOM / crash:** `fly scale memory 1024` hoặc xem `fly logs`.

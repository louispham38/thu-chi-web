import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "../auth";

const ERR_MSG: Record<string, string> = {
  missing_code: "Thiếu mã xác thực — thử lại.",
  bad_state: "State không hợp lệ — thử lại.",
  state_mismatch: "State không khớp (CSRF) — thử lại.",
  exchange_failed: "Không đổi được code lấy token. Kiểm tra Client ID/Secret trên Render.",
  no_access: "Google không trả access_token.",
  no_user: "Không lấy được thông tin user.",
};

export default function Login() {
  const { user, workspaces, loading, authEnabled } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const err = params.get("err");

  useEffect(() => {
    if (loading) return;
    if (!authEnabled) {
      // Server in legacy mode — there's no login flow, just go to app
      nav("/app", { replace: true });
      return;
    }
    if (user) {
      nav(workspaces.length > 0 ? "/app" : "/onboarding", { replace: true });
    }
  }, [user, workspaces, loading, authEnabled, nav]);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand center">
          <span className="logo">⌁</span>
          <strong>Thu / Chi</strong>
        </div>
        <h1>Đăng nhập</h1>
        <p className="auth-sub">
          App dùng <strong>Google OAuth</strong> để đọc/ghi Sheet trong Drive của bạn.
          Không lưu password — bạn có thể gỡ quyền bất cứ lúc nào trong{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            cài đặt Google
          </a>
          .
        </p>

        {err && <div className="banner err">{ERR_MSG[err] || `Lỗi: ${err}`}</div>}

        <a href="/auth/login?next=/app" className="btn-google">
          <GoogleIcon />
          <span>Đăng nhập bằng Google</span>
        </a>

        <p className="auth-foot">
          <Link to="/">← Về trang chủ</Link>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.59.1-1.16.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.43 1.34l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

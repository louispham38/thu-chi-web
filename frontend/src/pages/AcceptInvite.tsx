import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";

interface InvitePublic {
  workspace_name: string;
  invited_by: string;
  role: string;
  email: string;
  expired: boolean;
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { user, refresh, setCurrentWorkspaceId, loading } = useAuth();
  const nav = useNavigate();

  const [info, setInfo] = useState<InvitePublic | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetch invite info (public — no auth required)
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch(`/api/invites/${token}`);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.detail || `HTTP ${r.status}`);
        }
        setInfo(await r.json());
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [token]);

  async function accept() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/invites/${token}/accept`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `HTTP ${r.status}`);
      }
      const j = await r.json();
      await refresh();
      setCurrentWorkspaceId(j.workspace_id);
      nav("/app", { replace: true });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Lời mời không khả dụng</h1>
          <div className="banner err" style={{ marginTop: 0 }}>{err}</div>
          <p className="auth-foot">
            <Link to="/">← Về trang chủ</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!info || loading) {
    return <div className="boot-loading">Đang tải lời mời…</div>;
  }

  if (info.expired) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Lời mời đã hết hạn</h1>
          <p className="auth-sub">
            Yêu cầu người mời tạo lại lời mời mới.
          </p>
          <p className="auth-foot">
            <Link to="/">← Về trang chủ</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card wide">
        <div className="brand center">
          <span className="logo">⌁</span>
          <strong>Thu / Chi</strong>
        </div>
        <h1>Bạn được mời vào workspace</h1>
        <div className="invite-summary">
          <div className="inv-row">
            <span>Workspace</span>
            <strong>{info.workspace_name}</strong>
          </div>
          <div className="inv-row">
            <span>Người mời</span>
            <strong>{info.invited_by}</strong>
          </div>
          <div className="inv-row">
            <span>Quyền</span>
            <strong className={`role-tag role-${info.role}`}>{info.role}</strong>
          </div>
          <div className="inv-row">
            <span>Dành cho email</span>
            <strong>{info.email}</strong>
          </div>
        </div>

        {!user ? (
          <>
            <p className="auth-sub">
              Đăng nhập bằng <strong>{info.email}</strong> để chấp nhận lời mời.
            </p>
            <a
              href={`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="btn-google"
            >
              <span>Đăng nhập bằng Google</span>
            </a>
          </>
        ) : user.email.toLowerCase() !== info.email.toLowerCase() ? (
          <div className="banner err" style={{ marginTop: 0 }}>
            Bạn đang đăng nhập bằng <strong>{user.email}</strong>, nhưng lời mời này dành cho{" "}
            <strong>{info.email}</strong>. Đăng xuất và đăng nhập lại với đúng email.
          </div>
        ) : (
          <button type="button" className="btn primary big" disabled={busy} onClick={accept}>
            {busy ? "Đang xử lý…" : "Chấp nhận & vào workspace"}
          </button>
        )}

        <p className="auth-foot">
          <Link to="/">← Về trang chủ</Link>
        </p>
      </div>
    </div>
  );
}

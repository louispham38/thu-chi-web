import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export default function Profile() {
  const { user, workspaces, refresh, logout } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setName(user?.name || ""), [user?.name]);

  if (!user) return <div className="boot-loading">Đang tải profile…</div>;

  async function saveName() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      await refresh();
      setMsg({ kind: "ok", text: "Đã cập nhật tên hiển thị." });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  const ownedCount = workspaces.filter((w) => w.role === "owner").length;
  const canDelete = confirmText === "XOÁ TÀI KHOẢN";

  async function destroy() {
    if (!canDelete) return;
    setDeleting(true);
    try {
      await api("/api/me", { method: "DELETE" });
      await logout();
      nav("/", { replace: true });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
      setDeleting(false);
    }
  }

  return (
    <div className="settings-shell">
      <header className="settings-nav">
        <Link to="/app" className="back-link">
          ← Về ứng dụng
        </Link>
        <h1>Tài khoản</h1>
      </header>

      {msg && (
        <div className={`banner ${msg.kind}`}>
          <span>{msg.text}</span>
          <button type="button" className="close" onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      <section className="panel">
        <h2>Hồ sơ</h2>
        <div className="profile-row">
          <div className="m-avatar big">
            {user.picture ? (
              <img src={user.picture} alt={user.email} />
            ) : (
              <span className="avatar-fallback">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div className="form" style={{ flex: 1 }}>
            <label className="full">
              Email
              <input value={user.email} readOnly />
              <small className="hint" style={{ marginTop: 4 }}>Email do Google quản lý — không đổi được ở đây.</small>
            </label>
            <label className="full">
              Tên hiển thị
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={saving || name.trim() === user.name}
              onClick={saveName}
            >
              {saving ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Workspaces của bạn ({workspaces.length})</h2>
        {workspaces.length === 0 ? (
          <p className="hint">Chưa có workspace nào.</p>
        ) : (
          <ul className="ws-list">
            {workspaces.map((w) => (
              <li key={w.id}>
                <div>
                  <strong>{w.name}</strong>
                  <span className="hint" style={{ display: "block", fontSize: "0.78rem" }}>
                    Sheet ID: <code>{w.sheet_id}</code>
                  </span>
                </div>
                <span className={`role-tag role-${w.role}`}>{w.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel danger-zone">
        <h2>Xoá tài khoản</h2>
        <p className="hint">
          Xoá account khỏi app này. {ownedCount > 0 && `${ownedCount} workspace bạn đang owner cũng sẽ bị xoá. `}
          <strong>Google Sheet trên Drive của bạn không bị xoá</strong> — bạn vẫn truy cập được như Sheet bình thường.
          Để gỡ luôn quyền OAuth, vào{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            Google Account → Permissions
          </a>
          .
        </p>
        <label className="full" style={{ maxWidth: 320 }}>
          Gõ <code>XOÁ TÀI KHOẢN</code> để xác nhận
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="XOÁ TÀI KHOẢN"
          />
        </label>
        <button
          type="button"
          className="btn danger"
          disabled={!canDelete || deleting}
          onClick={destroy}
        >
          {deleting ? "Đang xoá…" : "Xoá vĩnh viễn tài khoản"}
        </button>
      </section>
    </div>
  );
}

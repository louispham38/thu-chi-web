import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

interface Member {
  user_id: number;
  email: string;
  name: string | null;
  picture: string | null;
  role: "owner" | "editor" | "viewer";
  is_default: boolean;
}

interface Invite {
  id: number;
  email: string;
  role: "editor" | "viewer";
  token: string;
  invite_url: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export default function WorkspaceSettings() {
  const { user, workspaces, currentWorkspaceId, refresh } = useAuth();
  const nav = useNavigate();

  const ws = workspaces.find((w) => w.id === currentWorkspaceId) ?? workspaces[0];
  const isOwner = ws?.role === "owner";
  const canInvite = ws?.role === "owner" || ws?.role === "editor";

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState(ws?.name ?? "");
  const [renaming, setRenaming] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => setName(ws?.name ?? ""), [ws?.id, ws?.name]);

  const reload = useCallback(async () => {
    if (!ws) return;
    try {
      const [m, i] = await Promise.all([
        api<Member[]>(`/api/workspaces/${ws.id}/members`),
        canInvite ? api<Invite[]>(`/api/workspaces/${ws.id}/invites`) : Promise.resolve([]),
      ]);
      setMembers(m);
      setInvites(i);
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    }
  }, [ws, canInvite]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!ws) return <div className="boot-loading">Đang tải workspace…</div>;

  async function rename() {
    setRenaming(true);
    try {
      await api(`/api/workspaces/${ws!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      setMsg({ kind: "ok", text: "Đã đổi tên." });
      await refresh();
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setRenaming(false);
    }
  }

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api<Invite>(`/api/workspaces/${ws!.id}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail("");
      setMsg({ kind: "ok", text: "Đã tạo lời mời. Copy link và gửi cho người được mời." });
      await reload();
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: number) {
    if (!confirm("Thu hồi lời mời này?")) return;
    try {
      await api(`/api/invites/${id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    }
  }

  async function removeMember(uid: number, email: string) {
    if (!confirm(`Xoá ${email} khỏi workspace?`)) return;
    try {
      await api(`/api/workspaces/${ws!.id}/members/${uid}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    }
  }

  async function leave() {
    if (!confirm("Rời khỏi workspace này? Bạn sẽ không truy cập được sheet nữa.")) return;
    try {
      await api(`/api/workspaces/${ws!.id}/leave`, { method: "POST" });
      await refresh();
      nav("/app", { replace: true });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    }
  }

  async function destroy() {
    if (!confirm("Xoá workspace này? Sheet trên Drive vẫn còn — chỉ xoá khỏi app.")) return;
    if (!confirm("Chắc chắn? Tất cả thành viên sẽ mất quyền truy cập qua app.")) return;
    try {
      await api(`/api/workspaces/${ws!.id}`, { method: "DELETE" });
      await refresh();
      nav("/app", { replace: true });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    }
  }

  function copyLink(inv: Invite) {
    navigator.clipboard.writeText(inv.invite_url);
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="settings-shell">
      <header className="settings-nav">
        <Link to="/app" className="back-link">
          ← Về ứng dụng
        </Link>
        <h1>Cài đặt workspace</h1>
      </header>

      {msg && (
        <div className={`banner ${msg.kind}`}>
          <span>{msg.text}</span>
          <button type="button" className="close" onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      <section className="panel">
        <h2>Thông tin chung</h2>
        <div className="form">
          <label className="full">
            Tên workspace
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
            />
          </label>
          <label className="full">
            Sheet ID
            <input value={ws.sheet_id} readOnly />
            <small className="hint" style={{ marginTop: 4 }}>
              <a href={`https://docs.google.com/spreadsheets/d/${ws.sheet_id}`} target="_blank" rel="noreferrer">
                Mở Google Sheet ↗
              </a>
            </small>
          </label>
          {isOwner && (
            <button
              type="button"
              className="btn primary"
              disabled={renaming || name.trim() === ws.name}
              onClick={rename}
            >
              {renaming ? "Đang lưu…" : "Lưu tên"}
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Thành viên ({members.length})</h2>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.user_id}>
              <div className="m-avatar">
                {m.picture ? (
                  <img src={m.picture} alt={m.email} />
                ) : (
                  <span className="avatar-fallback">{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="m-info">
                <strong>{m.name || m.email}</strong>
                <span>{m.email}</span>
              </div>
              <span className={`role-tag role-${m.role}`}>{m.role}</span>
              {isOwner && m.user_id !== user?.id && (
                <button type="button" className="btn-icon" onClick={() => removeMember(m.user_id, m.email)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canInvite && (
        <section className="panel">
          <h2>Mời thành viên</h2>
          <p className="hint">
            Tạo link mời, copy gửi qua email/tin nhắn. Khi người nhận đăng nhập bằng đúng email được mời, họ
            sẽ được tự động share Google Sheet và join workspace.
          </p>
          <div className="invite-form">
            <input
              type="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}>
              <option value="editor">Editor (chỉnh sửa)</option>
              <option value="viewer">Viewer (chỉ xem)</option>
            </select>
            <button type="button" className="btn primary" disabled={inviting} onClick={invite}>
              {inviting ? "Đang tạo…" : "Tạo lời mời"}
            </button>
          </div>

          {invites.length > 0 && (
            <ul className="invite-list">
              {invites.map((inv) => {
                const expired = !inv.accepted_at && new Date(inv.expires_at) < new Date();
                return (
                  <li key={inv.id} className={inv.accepted_at ? "accepted" : expired ? "expired" : ""}>
                    <div className="inv-info">
                      <strong>{inv.email}</strong>
                      <span className="inv-meta">
                        <span className={`role-tag role-${inv.role}`}>{inv.role}</span>
                        {inv.accepted_at ? (
                          <span className="status-ok">✓ Đã nhận</span>
                        ) : expired ? (
                          <span className="status-warn">Hết hạn</span>
                        ) : (
                          <span>Hết hạn {formatDate(inv.expires_at)}</span>
                        )}
                      </span>
                    </div>
                    {!inv.accepted_at && (
                      <>
                        <button
                          type="button"
                          className="btn-link small"
                          onClick={() => copyLink(inv)}
                        >
                          {copiedId === inv.id ? "✓ Đã copy" : "Copy link mời"}
                        </button>
                        <button type="button" className="btn-icon" onClick={() => revokeInvite(inv.id)}>
                          ×
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="panel danger-zone">
        <h2>Vùng nguy hiểm</h2>
        {ws.role === "owner" ? (
          <button type="button" className="btn danger" onClick={destroy}>
            Xoá workspace khỏi app
          </button>
        ) : (
          <button type="button" className="btn danger" onClick={leave}>
            Rời khỏi workspace
          </button>
        )}
        <p className="hint" style={{ marginTop: 12 }}>
          Sheet trên Google Drive <strong>không bị xoá</strong> khi bạn xoá/leave workspace.
        </p>
      </section>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

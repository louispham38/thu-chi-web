import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

type Mode = "create" | "adopt";

export default function Onboarding() {
  const { user, refresh, setCurrentWorkspaceId } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("create");
  const [workspaceName, setWorkspaceName] = useState("Thu/Chi của tôi");
  const [sheetId, setSheetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const url = mode === "create" ? "/api/onboarding/create-workspace" : "/api/onboarding/adopt-sheet";
      const body = mode === "create" ? { workspace_name: workspaceName } : {
        workspace_name: workspaceName,
        sheet_id: extractSheetId(sheetId),
      };
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `HTTP ${r.status}`);
      }
      const w = await r.json();
      await refresh();
      setCurrentWorkspaceId(w.id);
      nav("/app", { replace: true });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card wide">
        <div className="brand center">
          <span className="logo">⌁</span>
          <strong>Thu / Chi</strong>
        </div>
        <h1>Chào mừng{user?.name ? `, ${user.name}` : ""} 👋</h1>
        <p className="auth-sub">
          Bước cuối — chọn cách lưu trữ dữ liệu thu/chi của bạn. Mọi giao dịch sẽ ghi vào một Google Sheet
          trong <strong>Drive của bạn</strong> (không phải của chúng tôi).
        </p>

        <div className="mode-tabs">
          <button
            type="button"
            className={mode === "create" ? "active" : ""}
            onClick={() => setMode("create")}
          >
            Tạo Sheet mới
          </button>
          <button
            type="button"
            className={mode === "adopt" ? "active" : ""}
            onClick={() => setMode("adopt")}
          >
            Dùng Sheet đã có
          </button>
        </div>

        <form className="form" onSubmit={submit}>
          <label className="full">
            Tên workspace
            <input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Thu/Chi của tôi"
              required
            />
          </label>

          {mode === "adopt" && (
            <label className="full">
              Sheet ID hoặc URL
              <input
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                required
              />
              <small className="hint" style={{ marginTop: 4 }}>
                Sheet phải dùng cùng tài khoản Google bạn vừa đăng nhập, và có 3 tab:{" "}
                <code>Chi Tiêu</code>, <code>So_Du</code>, <code>Ke_Hoach_Quy</code>.
              </small>
            </label>
          )}

          {err && <div className="banner err" style={{ marginTop: 0 }}>{err}</div>}

          <button type="submit" disabled={busy} className="btn primary big">
            {busy
              ? "Đang xử lý…"
              : mode === "create"
                ? "Tạo Sheet & vào ứng dụng"
                : "Liên kết & vào ứng dụng"}
          </button>
        </form>
      </div>
    </div>
  );
}

function extractSheetId(input: string): string {
  // Accept "abc123" or full URL "https://docs.google.com/spreadsheets/d/<id>/..."
  const trimmed = input.trim();
  const m = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return trimmed;
}

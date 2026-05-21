import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { pickSheetWithBackendToken, type PickedFile } from "../lib/picker";

type Mode = "create" | "adopt";

export default function Onboarding() {
  const { user, refresh, setCurrentWorkspaceId } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("create");
  const [workspaceName, setWorkspaceName] = useState("Thu/Chi của tôi");
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handlePick() {
    setErr(null);
    try {
      const f = await pickSheetWithBackendToken();
      if (f) {
        setPicked(f);
        if (workspaceName === "Thu/Chi của tôi" || !workspaceName.trim()) {
          setWorkspaceName(f.name);
        }
      }
    } catch (e) {
      setErr(`Không mở được Google Picker: ${String(e)}`);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "adopt" && !picked) {
      setErr("Hãy bấm “Chọn từ Drive” để chọn Sheet trước.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const url =
        mode === "create" ? "/api/onboarding/create-workspace" : "/api/onboarding/adopt-sheet";
      const body =
        mode === "create"
          ? { workspace_name: workspaceName }
          : { workspace_name: workspaceName, sheet_id: picked!.id };
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
          Bước cuối — chọn cách lưu trữ dữ liệu thu/chi của bạn. Mọi giao dịch sẽ ghi vào một Google
          Sheet trong <strong>Drive của bạn</strong> (không phải của chúng tôi).
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
            <div className="full">
              <label>Google Sheet</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="btn" onClick={handlePick}>
                  {picked ? "Đổi sheet…" : "Chọn từ Drive…"}
                </button>
                {picked && (
                  <span className="hint" style={{ fontSize: 14 }}>
                    Đã chọn: <strong>{picked.name}</strong>{" "}
                    <code style={{ opacity: 0.6 }}>({picked.id.slice(0, 8)}…)</code>
                  </span>
                )}
              </div>
              <small className="hint" style={{ marginTop: 6, display: "block" }}>
                Mở Google Picker để chọn Sheet trong Drive của bạn. Sheet nên có 3 tab{" "}
                <code>Chi Tiêu</code>, <code>So_Du</code>, <code>Ke_Hoach_Quy</code> — nếu thiếu tab
                nào, ứng dụng sẽ tạo bù.
              </small>
            </div>
          )}

          {err && (
            <div className="banner err" style={{ marginTop: 0 }}>
              {err}
            </div>
          )}

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

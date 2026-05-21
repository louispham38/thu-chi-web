import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AccountRow,
  api,
  CashflowResp,
  ParseResult,
  PlanRow,
  Summary,
  Tx,
} from "./api";
import { useAuth } from "./auth";
import UserMenu from "./components/UserMenu";

type Tab = "dashboard" | "entry" | "cashflow" | "accounts" | "plan";

const COLORS = [
  "#06b6d4",
  "#8b5cf6",
  "#f97316",
  "#22c55e",
  "#ec4899",
  "#eab308",
  "#64748b",
];

function fmt(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(n) + " đ";
}

function currentMonth(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

type BannerState = { text: string; kind: "ok" | "err" } | null;

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [month, setMonth] = useState(currentMonth());
  const [sum, setSum] = useState<Summary | null>(null);
  const [range, setRange] = useState<Array<Summary & { month: string }>>([]);
  const [methods, setMethods] = useState<string[]>([]);
  const [accountRows, setAccountRows] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [funds, setFunds] = useState<string[]>([]);
  const [planRows, setPlanRows] = useState<PlanRow[]>([]);
  const [recentTxs, setRecentTxs] = useState<Tx[]>([]);
  const [banner, setBanner] = useState<BannerState>(null);

  function showOk(text: string) {
    setBanner({ text, kind: "ok" });
    setTimeout(() => setBanner(null), 3500);
  }
  function showErr(text: string) {
    setBanner({ text, kind: "err" });
  }

  const loadMeta = useCallback(async () => {
    const m = await api<{ categories: string[]; funds: string[] }>("/api/meta");
    setCategories(m.categories);
    setFunds(m.funds);
  }, []);

  const loadSummary = useCallback(async () => {
    const [s, r, txs] = await Promise.all([
      api<Summary>(`/api/summary?month=${encodeURIComponent(month)}`),
      api<Array<Summary & { month: string }>>("/api/summary/range?months_back=6"),
      api<Tx[]>("/api/transactions"),
    ]);
    setSum(s);
    setRange(r);
    // Last 10, newest first
    const filtered = txs
      .filter((t) => {
        const parts = t.date?.split("/");
        if (!parts || parts.length < 3) return false;
        return `${parts[1]}/${parts[2]}` === month;
      })
      .slice(-20)
      .reverse();
    setRecentTxs(filtered);
  }, [month]);

  const loadAccounts = useCallback(async () => {
    const a = await api<{ payment_methods: string[]; rows: AccountRow[] }>("/api/accounts");
    setMethods(a.payment_methods);
    setAccountRows(a.rows ?? []);
  }, []);

  const loadPlan = useCallback(async () => {
    const rows = await api<Array<{ fund: string; percent: number; amount: number; note: string }>>(
      `/api/planning?month=${encodeURIComponent(month)}`,
    );
    setPlanRows(rows.map((r) => ({ fund: r.fund, percent: r.percent, amount: r.amount, note: r.note || "" })));
  }, [month]);

  useEffect(() => {
    loadMeta().catch(() => {});
  }, [loadMeta]);

  useEffect(() => {
    if (tab === "dashboard") loadSummary().catch((e) => showErr(String(e)));
    if (tab === "accounts") loadAccounts().catch((e) => showErr(String(e)));
    if (tab === "plan") loadPlan().catch((e) => showErr(String(e)));
    if (tab === "entry") loadAccounts().catch((e) => showErr(String(e)));
  }, [tab, month, loadSummary, loadAccounts, loadPlan]);

  const pieData = useMemo(() => {
    if (!sum?.by_category) return [];
    return Object.entries(sum.by_category)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value }));
  }, [sum]);

  const barData = useMemo(
    () => range.map((x) => ({ month: x.month, Thu: x.thu, Chi: x.chi })),
    [range],
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">⌁</span>
          <div>
            <h1>Thu / Chi</h1>
            <WorkspaceLabel />
          </div>
        </div>
        <UserMenu />
        <nav className="tabs">
          {(
            [
              ["dashboard", "Dashboard"],
              ["entry", "Nhập Thu/Chi"],
              ["cashflow", "Cash flow"],
              ["accounts", "Tài khoản"],
              ["plan", "Kế hoạch quỹ"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} type="button" onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {banner && (
        <div className={`banner ${banner.kind}`}>
          <span>{banner.text}</span>
          <button type="button" className="close" onClick={() => setBanner(null)}>
            ×
          </button>
        </div>
      )}

      <main className="main">
        {tab === "dashboard" && (
          <section className="panel">
            <div className="row between">
              <h2>Thống kê tháng</h2>
              <label className="field inline">
                Tháng
                <input
                  type="text"
                  placeholder="MM/YYYY"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  style={{ width: "7rem" }}
                />
              </label>
            </div>

            {sum && (
              <div className="cards">
                <div className="card thu">
                  <span>Tổng Thu</span>
                  <strong>{fmt(sum.thu)}</strong>
                </div>
                <div className="card chi">
                  <span>Tổng Chi</span>
                  <strong>{fmt(sum.chi)}</strong>
                </div>
                <div className={`card ${sum.balance >= 0 ? "bal" : "neg"}`}>
                  <span>Chênh lệch</span>
                  <strong>{fmt(sum.balance)}</strong>
                </div>
              </div>
            )}

            <div className="charts">
              <div className="chart-box">
                <h3>Chi theo danh mục</h3>
                {pieData.length === 0 ? (
                  <p className="empty-chart">Chưa có dữ liệu chi trong tháng.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmt(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="chart-box">
                <h3>6 tháng gần nhất</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={barData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 10 }}
                      tickFormatter={(v) => `${Math.round(v / 1e6)}M`}
                      width={38}
                    />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend />
                    <Bar dataKey="Thu" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Chi" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {recentTxs.length > 0 && (
              <div className="recent">
                <h3>Giao dịch trong tháng ({recentTxs.length})</h3>
                <div className="tx-table-wrap">
                  <table className="tx-table">
                    <thead>
                      <tr>
                        <th>Ngày</th>
                        <th>Loại</th>
                        <th>Mô tả</th>
                        <th>Danh mục</th>
                        <th>PT</th>
                        <th style={{ textAlign: "right" }}>Số tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTxs.map((t, i) => (
                        <tr key={i} className={t.thu_chi === "Thu" ? "row-thu" : "row-chi"}>
                          <td>{t.date}</td>
                          <td>
                            <span className={`badge ${t.thu_chi === "Thu" ? "thu" : "chi"}`}>{t.thu_chi}</span>
                          </td>
                          <td>{t.description || "—"}</td>
                          <td>{t.category}</td>
                          <td>{t.payment_method}</td>
                          <td style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{fmt(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "entry" && (
          <EntryForm
            categories={categories}
            methods={methods}
            onSaved={() => {
              showOk("Đã ghi vào Google Sheet.");
              loadSummary().catch(() => {});
              setTab("dashboard");
            }}
            onError={showErr}
          />
        )}

        {tab === "cashflow" && (
          <CashflowTab onError={showErr} />
        )}

        {tab === "accounts" && (
          <AccountsTable
            rows={accountRows}
            onSaved={async () => {
              await loadAccounts();
              showOk("Đã lưu Số dư tài khoản.");
            }}
            onError={showErr}
          />
        )}

        {tab === "plan" && (
          <PlanningTable
            month={month}
            setMonth={setMonth}
            funds={funds.length ? funds : DEFAULT_FALLBACK_FUNDS}
            rows={planRows}
            setRows={setPlanRows}
            onSave={async () => {
              await api("/api/planning", {
                method: "POST",
                body: JSON.stringify({ month, rows: planRows }),
              });
              showOk("Đã lưu kế hoạch phân bổ.");
            }}
          />
        )}
      </main>

      <footer className="footer">
        Sheet: <strong>Chi Tiêu</strong> · <strong>So_Du</strong> · <strong>Ke_Hoach_Quy</strong>
      </footer>
    </div>
  );
}

// ─────────────────────── Cash flow ───────────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dmy(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function dmyToISO(s: string): string {
  // "dd/mm/yyyy" -> "yyyy-mm-dd" for <input type="date">
  const p = s.split("/");
  if (p.length !== 3) return "";
  return `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
}

function isoToDmy(s: string): string {
  // "yyyy-mm-dd" -> "dd/mm/yyyy"
  const p = s.split("-");
  if (p.length !== 3) return s;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

type CashflowPreset = "this-week" | "last-7" | "this-month" | "last-30" | "custom";

function presetRange(p: CashflowPreset): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const to = today;
  if (p === "last-7") {
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return { from: dmy(from), to: dmy(to) };
  }
  if (p === "last-30") {
    const from = new Date(today);
    from.setDate(today.getDate() - 29);
    return { from: dmy(from), to: dmy(to) };
  }
  if (p === "this-week") {
    // Monday of this week
    const dow = (today.getDay() + 6) % 7; // 0=Mon..6=Sun
    const from = new Date(today);
    from.setDate(today.getDate() - dow);
    return { from: dmy(from), to: dmy(to) };
  }
  if (p === "this-month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: dmy(from), to: dmy(to) };
  }
  // custom — default to current month
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: dmy(from), to: dmy(to) };
}

const WEEKDAY_LABEL = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function CashflowTab({ onError }: { onError: (s: string) => void }) {
  const [preset, setPreset] = useState<CashflowPreset>("this-month");
  const initial = useMemo(() => presetRange("this-month"), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<CashflowResp | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    try {
      const r = await api<CashflowResp>(
        `/api/cashflow?date_from=${encodeURIComponent(f)}&date_to=${encodeURIComponent(t)}`,
      );
      setData(r);
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load(from, to);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(p: CashflowPreset) {
    setPreset(p);
    if (p === "custom") return;
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
    load(r.from, r.to);
  }

  function applyCustom() {
    setPreset("custom");
    load(from, to);
  }

  const chartData = useMemo(
    () =>
      (data?.days ?? []).map((d) => ({
        date: d.date.slice(0, 5), // dd/mm
        Thu: d.thu,
        Chi: d.chi,
        Net: d.balance,
      })),
    [data],
  );

  return (
    <section className="panel">
      <div className="row between">
        <h2>Cash flow theo ngày</h2>
        <span className="hint" style={{ margin: 0 }}>
          {data ? `${data.from} → ${data.to}` : "—"}
        </span>
      </div>

      {/* Preset chips */}
      <div className="cf-presets">
        {(
          [
            ["this-week", "Tuần này"],
            ["last-7", "7 ngày"],
            ["this-month", "Tháng này"],
            ["last-30", "30 ngày"],
            ["custom", "Tùy chỉnh"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`cf-chip ${preset === id ? "active" : ""}`}
            onClick={() => applyPreset(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="cf-custom">
          <label>
            Từ
            <input
              type="date"
              value={dmyToISO(from)}
              onChange={(e) => setFrom(isoToDmy(e.target.value))}
            />
          </label>
          <label>
            Đến
            <input
              type="date"
              value={dmyToISO(to)}
              onChange={(e) => setTo(isoToDmy(e.target.value))}
            />
          </label>
          <button type="button" className="btn primary send-btn" onClick={applyCustom}>
            Áp dụng
          </button>
        </div>
      )}

      {/* Summary cards */}
      {data && (
        <div className="cards" style={{ marginTop: "1rem" }}>
          <div className="card thu">
            <span>Tổng Thu</span>
            <strong>{new Intl.NumberFormat("vi-VN").format(data.totals.thu)} đ</strong>
          </div>
          <div className="card chi">
            <span>Tổng Chi</span>
            <strong>{new Intl.NumberFormat("vi-VN").format(data.totals.chi)} đ</strong>
          </div>
          <div className={`card ${data.totals.balance >= 0 ? "bal" : "neg"}`}>
            <span>Net cash flow</span>
            <strong className={data.totals.balance < 0 ? "neg-val" : ""}>
              {data.totals.balance >= 0 ? "+" : ""}
              {new Intl.NumberFormat("vi-VN").format(data.totals.balance)} đ
            </strong>
          </div>
          <div className="card bal">
            <span>Số ngày · giao dịch</span>
            <strong>
              {data.totals.day_count} · {data.totals.tx_count}
            </strong>
          </div>
        </div>
      )}

      {/* Chart */}
      <h3>Biểu đồ Thu/Chi theo ngày</h3>
      {loading ? (
        <p className="empty-chart">Đang tải…</p>
      ) : !data || chartData.length === 0 ? (
        <p className="empty-chart">Không có giao dịch trong khoảng này.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 10 }}
              tickFormatter={(v) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}k`)}
              width={45}
            />
            <Tooltip
              formatter={(v: number) => new Intl.NumberFormat("vi-VN").format(v) + " đ"}
              labelStyle={{ color: "#0f172a" }}
            />
            <Legend />
            <Bar dataKey="Thu" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Chi" stackId="b" fill="#f97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Daily table */}
      {data && data.days.length > 0 && (
        <>
          <h3>Bảng chi tiết theo ngày</h3>
          <div className="tx-table-wrap">
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Thứ</th>
                  <th style={{ textAlign: "right" }}>Thu</th>
                  <th style={{ textAlign: "right" }}>Chi</th>
                  <th style={{ textAlign: "right" }}>Net</th>
                  <th style={{ textAlign: "right" }}>GD</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => {
                  const empty = d.count === 0;
                  return (
                    <tr key={d.date} className={empty ? "row-empty" : ""}>
                      <td className="acct-name">{d.date}</td>
                      <td>{WEEKDAY_LABEL[d.weekday]}</td>
                      <td className="num-cell" style={{ color: d.thu > 0 ? "var(--thu)" : undefined }}>
                        {d.thu > 0 ? new Intl.NumberFormat("vi-VN").format(d.thu) + " đ" : <span className="muted">—</span>}
                      </td>
                      <td className="num-cell" style={{ color: d.chi > 0 ? "var(--chi)" : undefined }}>
                        {d.chi > 0 ? new Intl.NumberFormat("vi-VN").format(d.chi) + " đ" : <span className="muted">—</span>}
                      </td>
                      <td className={`num-cell ${d.balance < 0 ? "cell-neg" : d.balance > 0 ? "cell-pos" : ""}`}>
                        {d.count === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            {d.balance > 0 ? "+" : ""}
                            {new Intl.NumberFormat("vi-VN").format(d.balance)} đ
                          </>
                        )}
                      </td>
                      <td className="num-cell">{d.count || <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="sum-row">
                  <td colSpan={2}><strong>Tổng cộng</strong></td>
                  <td className="num-cell" style={{ color: "var(--thu)" }}>
                    <strong>{new Intl.NumberFormat("vi-VN").format(data.totals.thu)} đ</strong>
                  </td>
                  <td className="num-cell" style={{ color: "var(--chi)" }}>
                    <strong>{new Intl.NumberFormat("vi-VN").format(data.totals.chi)} đ</strong>
                  </td>
                  <td className={`num-cell ${data.totals.balance < 0 ? "cell-neg" : "cell-pos"}`}>
                    <strong>
                      {data.totals.balance >= 0 ? "+" : ""}
                      {new Intl.NumberFormat("vi-VN").format(data.totals.balance)} đ
                    </strong>
                  </td>
                  <td className="num-cell"><strong>{data.totals.tx_count}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

interface EditRow {
  name: string;
  dau_ky: number;
  hien_co: number;
  /** Local-only id for stable React keys while editing. */
  _id: string;
}

function AccountsTable({
  rows,
  onSaved,
  onError,
}: {
  rows: AccountRow[];
  onSaved: () => Promise<void> | void;
  onError: (s: string) => void;
}) {
  const fmtAmt = (n: number | null) => {
    if (n === null || n === undefined) return <span className="muted">—</span>;
    const s = new Intl.NumberFormat("vi-VN").format(n) + " đ";
    return <span className={n < 0 ? "neg-val" : ""}>{s}</span>;
  };

  const dataRows = rows.filter((r) => r.name !== "SUM=" && r.name !== "Nguồn");
  const sumRow = rows.find((r) => r.name === "SUM=");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState(false);

  const totalDau = dataRows.reduce((s, r) => s + (r.dau_ky ?? 0), 0);
  const totalHien = dataRows.reduce((s, r) => s + (r.hien_co ?? 0), 0);

  function startEdit() {
    setDraft(
      dataRows.map((r, i) => ({
        name: r.name,
        dau_ky: r.dau_ky ?? 0,
        hien_co: r.hien_co ?? 0,
        _id: `${r.name}-${i}`,
      })),
    );
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft([]);
  }

  function addRow() {
    setDraft((d) => [
      ...d,
      { name: "", dau_ky: 0, hien_co: 0, _id: `new-${Date.now()}-${d.length}` },
    ]);
  }

  function removeRow(id: string) {
    setDraft((d) => d.filter((r) => r._id !== id));
  }

  function patchRow(id: string, patch: Partial<EditRow>) {
    setDraft((d) => d.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  }

  async function save() {
    const seen = new Set<string>();
    for (const r of draft) {
      const name = r.name.trim();
      if (!name) {
        onError("Có dòng chưa nhập tên nguồn.");
        return;
      }
      if (name === "SUM=") {
        onError("Tên 'SUM=' bị reserved cho dòng tổng.");
        return;
      }
      const key = name.toLowerCase();
      if (seen.has(key)) {
        onError(`Trùng tên nguồn: ${name}`);
        return;
      }
      seen.add(key);
    }
    setSaving(true);
    try {
      await api("/api/accounts", {
        method: "PUT",
        body: JSON.stringify({
          rows: draft.map((r) => ({
            name: r.name.trim(),
            dau_ky: Math.trunc(Number(r.dau_ky) || 0),
            hien_co: Math.trunc(Number(r.hien_co) || 0),
          })),
        }),
      });
      setEditing(false);
      setDraft([]);
      await onSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editing) {
    const dDau = draft.reduce((s, r) => s + (Number(r.dau_ky) || 0), 0);
    const dHien = draft.reduce((s, r) => s + (Number(r.hien_co) || 0), 0);
    return (
      <section className="panel">
        <div className="row between" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Chỉnh sửa nguồn tài khoản</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>
              Huỷ
            </button>
            <button type="button" className="btn primary" onClick={save} disabled={saving}>
              {saving ? "Đang lưu…" : "Lưu vào Google Sheet"}
            </button>
          </div>
        </div>

        <div className="tx-table-wrap">
          <table className="sodu-table editable">
            <thead>
              <tr>
                <th style={{ width: "40%" }}>Nguồn</th>
                <th style={{ width: "25%" }}>Đầu kỳ (đ)</th>
                <th style={{ width: "25%" }}>Hiện có (đ)</th>
                <th style={{ width: "10%" }}></th>
              </tr>
            </thead>
            <tbody>
              {draft.map((r) => (
                <tr key={r._id}>
                  <td>
                    <input
                      type="text"
                      value={r.name}
                      onChange={(e) => patchRow(r._id, { name: e.target.value })}
                      placeholder="vd: Tiền mặt, Vietcombank…"
                      className="cell-input"
                      autoFocus={!r.name}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={r.dau_ky}
                      onChange={(e) => patchRow(r._id, { dau_ky: parseInt(e.target.value || "0", 10) })}
                      className="cell-input num-cell"
                      step={1000}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={r.hien_co}
                      onChange={(e) => patchRow(r._id, { hien_co: parseInt(e.target.value || "0", 10) })}
                      className="cell-input num-cell"
                      step={1000}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-icon"
                      title="Xoá nguồn này"
                      onClick={() => removeRow(r._id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {draft.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <p className="empty-chart" style={{ margin: "1rem 0" }}>
                      Chưa có nguồn nào — bấm “+ Thêm nguồn” bên dưới.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="sum-row">
                <td><strong>SUM= (tự tính)</strong></td>
                <td className="num-cell"><strong>{new Intl.NumberFormat("vi-VN").format(dDau)} đ</strong></td>
                <td className="num-cell"><strong>{new Intl.NumberFormat("vi-VN").format(dHien)} đ</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={addRow}>+ Thêm nguồn</button>
          <span className="hint" style={{ margin: 0 }}>
            Dòng SUM= sẽ tự cập nhật bằng formula <code>=SUM(...)</code> trong Google Sheet.
          </span>
        </div>
      </section>
    );
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  return (
    <section className="panel">
      <div className="row between" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Số dư tài khoản</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="hint" style={{ margin: 0 }}>
            Sheet <strong>So_Du</strong>
          </span>
          <button type="button" className="btn primary" onClick={startEdit}>
            Chỉnh sửa
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div>
          <p className="empty-chart">Chưa có nguồn nào trong sheet So_Du.</p>
          <button type="button" className="btn primary" onClick={startEdit}>
            Thêm nguồn đầu tiên
          </button>
        </div>
      ) : (
        <>
          {/* ── Summary cards ── */}
          <div className="cards" style={{ marginBottom: "1.25rem" }}>
            <div className={`card ${totalDau >= 0 ? "bal" : "neg"}`}>
              <span>Tổng đầu kỳ</span>
              <strong className={totalDau < 0 ? "neg-val" : ""}>
                {new Intl.NumberFormat("vi-VN").format(totalDau)} đ
              </strong>
            </div>
            <div className={`card ${totalHien >= 0 ? "bal" : "neg"}`}>
              <span>Tổng hiện có</span>
              <strong className={totalHien < 0 ? "neg-val" : ""}>
                {new Intl.NumberFormat("vi-VN").format(totalHien)} đ
              </strong>
            </div>
            <div className={`card ${totalHien - totalDau >= 0 ? "thu" : "chi"}`}>
              <span>Thay đổi kỳ</span>
              <strong className={totalHien - totalDau < 0 ? "neg-val" : "pos-val"}>
                {totalHien - totalDau >= 0 ? "+" : ""}
                {new Intl.NumberFormat("vi-VN").format(totalHien - totalDau)} đ
              </strong>
            </div>
          </div>

          {/* ── Full table ── */}
          <div className="tx-table-wrap">
            <table className="sodu-table">
              <thead>
                <tr>
                  <th>Nguồn</th>
                  <th>Đầu kỳ</th>
                  <th>Hiện có</th>
                  <th>Thay đổi</th>
                </tr>
              </thead>
              <tbody>
                {dataRows.map((r) => {
                  const diff = (r.hien_co ?? 0) - (r.dau_ky ?? 0);
                  return (
                    <tr key={r.name} className={(r.hien_co ?? 0) < 0 ? "row-neg" : ""}>
                      <td className="acct-name">{r.name}</td>
                      <td className="num-cell">{fmtAmt(r.dau_ky)}</td>
                      <td className={`num-cell ${(r.hien_co ?? 0) < 0 ? "cell-neg" : ""}`}>
                        {fmtAmt(r.hien_co)}
                      </td>
                      <td className={`num-cell ${diff < 0 ? "cell-neg" : diff > 0 ? "cell-pos" : ""}`}>
                        {r.dau_ky !== null && r.hien_co !== null ? (
                          <>{diff > 0 ? "+" : ""}{new Intl.NumberFormat("vi-VN").format(diff)} đ</>
                        ) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {sumRow && (
                <tfoot>
                  <tr className="sum-row">
                    <td><strong>SUM=</strong></td>
                    <td className="num-cell"><strong className={(sumRow.dau_ky ?? 0) < 0 ? "neg-val" : ""}>{fmtAmt(sumRow.dau_ky)}</strong></td>
                    <td className={`num-cell ${(sumRow.hien_co ?? 0) < 0 ? "cell-neg" : ""}`}><strong>{fmtAmt(sumRow.hien_co)}</strong></td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const DEFAULT_FALLBACK_FUNDS = [
  "Sinh hoạt phí",
  "Tích luỹ",
  "Đầu tư",
  "Dự phòng",
  "Cho đi",
  "Quỹ hưu",
  "Quỹ đầu tư tương lai",
];

function EntryForm({
  categories,
  methods,
  onSaved,
  onError,
}: {
  categories: string[];
  methods: string[];
  onSaved: () => void;
  onError: (s: string) => void;
}) {
  const [chatText, setChatText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "bot"; text: string }>>([]);

  // Form fields (editable after parse)
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("Ăn uống");
  const [pm, setPm] = useState("Tiền mặt");
  const [tc, setTc] = useState<"Thu" | "Chi">("Chi");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // Seed default form values when categories/methods first load
  useEffect(() => {
    if (categories.length && cat === "Ăn uống" && !categories.includes("Ăn uống")) {
      setCat(categories[0]);
    }
  }, [categories]);

  useEffect(() => {
    if (methods.length && pm === "Tiền mặt" && !methods.includes("Tiền mặt")) {
      setPm(methods[0]);
    }
  }, [methods]);

  async function handleChatSend() {
    const text = chatText.trim();
    if (!text) return;
    setChatText("");
    setChatHistory((h) => [...h, { role: "user", text }]);
    setParsing(true);
    try {
      const result = await api<ParseResult>("/api/parse", {
        method: "POST",
        body: JSON.stringify({ text }),
      });

      // Update form fields
      if (result.amount > 0) setAmount(String(result.amount));
      setTc(result.thu_chi);
      setCat(result.category);
      setPm(result.payment_method);
      setDesc(result.description);
      setShowForm(true);

      const confLabel =
        result.confidence === "high" ? "✅" : result.confidence === "medium" ? "⚠️" : "❓";
      const reply =
        `${confLabel} Đã nhận diện:\n` +
        `• Loại: **${result.thu_chi}**\n` +
        `• Số tiền: **${new Intl.NumberFormat("vi-VN").format(result.amount)} đ**\n` +
        `• Danh mục: **${result.category}**\n` +
        `• Tài khoản: **${result.payment_method}**\n` +
        `• Mô tả: ${result.description || "—"}\n\n` +
        `Kiểm tra form bên dưới, chỉnh nếu cần rồi nhấn **Ghi vào Sheet**.`;
      setChatHistory((h) => [...h, { role: "bot", text: reply }]);
    } catch (err) {
      setChatHistory((h) => [
        ...h,
        { role: "bot", text: `❌ Không nhận diện được: ${String(err)}` },
      ]);
    } finally {
      setParsing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(amount.replace(/\D/g, ""), 10);
    if (!n || n <= 0) {
      onError("Nhập số tiền hợp lệ.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          amount: n,
          description: desc,
          category: cat,
          payment_method: pm,
          thu_chi: tc,
          date: date.trim() || null,
          note: "",
        }),
      });
      setChatHistory((h) => [
        ...h,
        { role: "bot", text: `✅ Đã ghi: **${tc}** ${new Intl.NumberFormat("vi-VN").format(n)} đ — ${cat}` },
      ]);
      setShowForm(false);
      setAmount("");
      setDesc("");
      onSaved();
    } catch (err) {
      onError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2>Nhập Thu / Chi</h2>
      <p className="hint">
        Gõ như nhắn tin Bot Telegram — hệ thống tự nhận diện số tiền, loại, danh mục, tài khoản.
      </p>

      {/* ── Chat window ── */}
      <div className="chat-window">
        {chatHistory.length === 0 && (
          <div className="chat-placeholder">
            <p>Ví dụ:</p>
            <ul>
              <li>ăn sáng 50k tiền mặt</li>
              <li>đổ xăng 150,000 vpbank</li>
              <li>thu lương 15tr techcombank</li>
              <li>mua quần áo 320k vcb chi</li>
            </ul>
          </div>
        )}
        {chatHistory.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>
            <ChatBubble text={msg.text} />
          </div>
        ))}
        {parsing && (
          <div className="chat-msg bot">
            <div className="chat-bubble typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* ── Chat input ── */}
      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="Nhập nội dung giao dịch…"
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleChatSend();
            }
          }}
          disabled={parsing}
          autoFocus
        />
        <button
          type="button"
          className="btn primary send-btn"
          onClick={handleChatSend}
          disabled={parsing || !chatText.trim()}
        >
          Gửi
        </button>
      </div>

      {/* ── Confirmation form ── */}
      {showForm && (
        <div className="confirm-form">
          <div className="confirm-header">
            <span>Xác nhận trước khi ghi</span>
            <button type="button" className="close" onClick={() => setShowForm(false)}>×</button>
          </div>
          <form className="form" onSubmit={submit}>
            <div className="grid2">
              <label>
                Thu / Chi
                <select value={tc} onChange={(e) => setTc(e.target.value as "Thu" | "Chi")}>
                  <option value="Chi">Chi tiêu</option>
                  <option value="Thu">Thu nhập</option>
                </select>
              </label>
              <label>
                Số tiền (VND)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </label>
              <label>
                Ngày <span style={{ opacity: 0.6 }}>(để trống = hôm nay)</span>
                <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="dd/mm/yyyy" />
              </label>
              <label>
                Danh mục
                <select value={cat} onChange={(e) => setCat(e.target.value)}>
                  {(categories.length ? categories : ["Khác"]).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Tài khoản
                <select value={pm} onChange={(e) => setPm(e.target.value)}>
                  {(methods.length ? methods : ["Tiền mặt"]).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="full">
                Mô tả
                <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ăn sáng, xăng xe…" />
              </label>
            </div>
            <div className="form-actions">
              <button type="submit" disabled={saving} className="btn primary">
                {saving ? "Đang ghi…" : "Ghi vào Sheet"}
              </button>
              <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>
                Huỷ
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function ChatBubble({ text }: { text: string }) {
  // Simple markdown: **bold**
  const html = text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
  return <div className="chat-bubble" dangerouslySetInnerHTML={{ __html: html }} />;
}

function PlanningTable({
  month,
  setMonth,
  funds,
  rows,
  setRows,
  onSave,
}: {
  month: string;
  setMonth: (s: string) => void;
  funds: string[];
  rows: PlanRow[];
  setRows: (r: PlanRow[]) => void;
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  function syncFundRow(fund: string): PlanRow {
    return rows.find((r) => r.fund === fund) || { fund, percent: 0, amount: 0, note: "" };
  }

  function updateRow(fund: string, patch: Partial<PlanRow>) {
    const next = funds.map((f) => {
      const base = syncFundRow(f);
      return f === fund ? { ...base, ...patch } : base;
    });
    setRows(next);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  }

  const totalPct = funds.reduce((acc, f) => acc + (syncFundRow(f).percent || 0), 0);
  const totalAmt = funds.reduce((acc, f) => acc + (syncFundRow(f).amount || 0), 0);

  return (
    <section className="panel">
      <div className="row between">
        <h2>Lập kế hoạch phân bổ thu nhập</h2>
        <label className="field inline">
          Tháng
          <input value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "7rem" }} />
        </label>
      </div>
      <p className="hint">
        Phân bổ thu nhập vào các quỹ — lưu vào sheet <strong>Ke_Hoach_Quy</strong>. Điền % hoặc số tiền dự kiến.
      </p>
      <div className={`pct-total ${Math.abs(totalPct - 100) < 0.5 ? "ok" : "warn"}`}>
        Tổng %: <strong>{totalPct.toFixed(1)}%</strong>
        {totalAmt > 0 && (
          <>
            {" "}· Tổng tiền: <strong>{new Intl.NumberFormat("vi-VN").format(totalAmt)} đ</strong>
          </>
        )}
        {Math.abs(totalPct - 100) >= 0.5 && totalPct > 0 && " — gợi ý tổng ~100%"}
      </div>
      <table className="plan-table">
        <thead>
          <tr>
            <th>Quỹ</th>
            <th>%</th>
            <th>Số tiền (VND)</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {funds.map((fund) => {
            const r = syncFundRow(fund);
            return (
              <tr key={fund}>
                <td className="fund-name">{fund}</td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={r.percent || ""}
                    onChange={(e) => updateRow(fund, { percent: parseFloat(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={r.amount || ""}
                    onChange={(e) => updateRow(fund, { amount: parseInt(e.target.value, 10) || 0 })}
                  />
                </td>
                <td>
                  <input value={r.note} onChange={(e) => updateRow(fund, { note: e.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="btn primary" disabled={saving} onClick={save}>
        {saving ? "Đang lưu…" : "Lưu kế hoạch"}
      </button>
    </section>
  );
}

function WorkspaceLabel() {
  const { workspaces, currentWorkspaceId, authEnabled } = useAuth();
  if (!authEnabled) {
    return <p className="sub">Đồng bộ Google Sheet · OpenClaw Bot</p>;
  }
  const ws = workspaces.find((w) => w.id === currentWorkspaceId) ?? workspaces[0];
  if (!ws) return <p className="sub">Đang tải workspace…</p>;
  return <p className="sub">{ws.name}</p>;
}

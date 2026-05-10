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
import { AccountRow, api, ParseResult, PlanRow, Summary, Tx } from "./api";

type Tab = "dashboard" | "entry" | "accounts" | "plan";

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
            <p className="sub">Đồng bộ Google Sheet · OpenClaw Bot</p>
          </div>
        </div>
        <nav className="tabs">
          {(
            [
              ["dashboard", "Dashboard"],
              ["entry", "Nhập Thu/Chi"],
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

        {tab === "accounts" && (
          <AccountsTable rows={accountRows} />
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

function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const fmtAmt = (n: number | null) => {
    if (n === null || n === undefined) return <span className="muted">—</span>;
    const s = new Intl.NumberFormat("vi-VN").format(n) + " đ";
    return <span className={n < 0 ? "neg-val" : ""}>{s}</span>;
  };

  // rows that are real accounts (skip SUM= header-like rows for separate display)
  const dataRows = rows.filter((r) => r.name !== "SUM=" && r.name !== "Nguồn");
  const sumRow = rows.find((r) => r.name === "SUM=");

  // total balance for mini summary cards
  const totalDau = dataRows.reduce((s, r) => s + (r.dau_ky ?? 0), 0);
  const totalHien = dataRows.reduce((s, r) => s + (r.hien_co ?? 0), 0);

  return (
    <section className="panel">
      <div className="row between" style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Số dư tài khoản</h2>
        <span className="hint" style={{ margin: 0 }}>Sheet <strong>So_Du</strong> — chỉnh trực tiếp trên Google Sheet để thêm/xóa</span>
      </div>

      {rows.length === 0 ? (
        <p className="empty-chart">Không đọc được sheet So_Du.</p>
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

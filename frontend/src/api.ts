const API_BASE = import.meta.env.VITE_API_URL ?? "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  const key = import.meta.env.VITE_API_KEY;
  if (key) headers["X-API-Key"] = key;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail || String(res.status));
  }
  return res.json() as Promise<T>;
}

export interface Tx {
  date: string;
  time?: string;
  thu_chi: string;
  payment_method: string;
  category: string;
  description: string;
  amount: number;
  note?: string;
}

export interface Summary {
  thu: number;
  chi: number;
  balance: number;
  by_category: Record<string, number>;
}

export interface AccountRow {
  name: string;
  dau_ky: number | null;
  hien_co: number | null;
}

export interface PlanRow {
  fund: string;
  percent: number;
  amount: number;
  note: string;
}

export interface ParseResult {
  amount: number;
  thu_chi: "Thu" | "Chi";
  category: string;
  payment_method: string;
  description: string;
  confidence: "high" | "medium" | "low";
}

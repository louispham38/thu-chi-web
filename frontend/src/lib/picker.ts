/**
 * Google Picker loader + helper.
 *
 * Picker requires:
 *  - The legacy `gapi` script (https://apis.google.com/js/api.js) to load the
 *    "picker" module
 *  - An OAuth access_token belonging to the signed-in user
 *  - A browser API key with the Picker API enabled
 *
 * Why Picker (not "paste ID"): with the `drive.file` (non-sensitive) OAuth
 * scope, an app may only access files it created OR files explicitly opened
 * by the user via Picker. Picking a file in this dialog registers it with
 * Google so subsequent `gspread.open_by_key(...)` calls server-side succeed.
 */

declare global {
  interface Window {
    gapi?: GApi;
    google?: { picker?: GooglePickerNamespace };
  }
}

interface GApi {
  load: (name: string, opts: { callback?: () => void; onerror?: (e: unknown) => void }) => void;
}

interface GooglePickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  ViewId: { SPREADSHEETS: unknown };
  Action: { PICKED: string; CANCEL: string };
  DocsView: new (viewId: unknown) => DocsView;
  Feature: { NAV_HIDDEN: string; MULTISELECT_ENABLED: string };
}

interface DocsView {
  setOwnedByMe: (b: boolean) => DocsView;
  setIncludeFolders: (b: boolean) => DocsView;
  setMimeTypes: (s: string) => DocsView;
}

interface PickerBuilder {
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  addView: (v: unknown) => PickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => PickerBuilder;
  setTitle: (t: string) => PickerBuilder;
  enableFeature: (f: string) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

interface PickerCallbackData {
  action: string;
  docs?: Array<{ id: string; name: string; mimeType: string }>;
}

export interface PickedFile {
  id: string;
  name: string;
}

const GAPI_SRC = "https://apis.google.com/js/api.js";

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Cannot load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error(`Cannot load ${src}`));
    document.head.appendChild(s);
  });
}

let pickerLoaded: Promise<void> | null = null;

async function ensurePickerLoaded(): Promise<void> {
  if (pickerLoaded) return pickerLoaded;
  pickerLoaded = (async () => {
    await injectScript(GAPI_SRC);
    const gapi = window.gapi;
    if (!gapi) throw new Error("gapi không load được");
    await new Promise<void>((resolve, reject) => {
      gapi.load("picker", {
        callback: () => resolve(),
        onerror: (e) => reject(new Error(`gapi.load(picker) lỗi: ${String(e)}`)),
      });
    });
    if (!window.google?.picker) {
      throw new Error("google.picker chưa khả dụng sau khi load");
    }
  })();
  return pickerLoaded;
}

interface PickConfig {
  oauthToken: string;
  apiKey: string;
  appId?: string;
  title?: string;
}

/**
 * Open the Google Picker dialog filtered to spreadsheets owned by the user.
 *
 * Resolves with the picked file (id + name) or null if the user cancels.
 */
export async function pickSpreadsheet(cfg: PickConfig): Promise<PickedFile | null> {
  await ensurePickerLoaded();
  const ns = window.google!.picker!;

  return new Promise((resolve, reject) => {
    try {
      const view = new ns.DocsView(ns.ViewId.SPREADSHEETS)
        .setOwnedByMe(false)
        .setIncludeFolders(true)
        .setMimeTypes("application/vnd.google-apps.spreadsheet");

      const builder = new ns.PickerBuilder()
        .setOAuthToken(cfg.oauthToken)
        .setDeveloperKey(cfg.apiKey)
        .addView(view)
        .setTitle(cfg.title || "Chọn Google Sheet")
        .setCallback((data) => {
          if (data.action === ns.Action.PICKED) {
            const doc = data.docs?.[0];
            if (doc) resolve({ id: doc.id, name: doc.name });
            else resolve(null);
          } else if (data.action === ns.Action.CANCEL) {
            resolve(null);
          }
        });
      if (cfg.appId) builder.setAppId(cfg.appId);
      builder.build().setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
}

/** Fetch a fresh OAuth access_token + Picker config from the backend. */
export async function fetchPickerConfig(): Promise<{
  access_token: string;
  api_key: string;
  client_id: string;
}> {
  const r = await fetch("/api/auth/google-token", { credentials: "include" });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.detail || `Không lấy được token Google (HTTP ${r.status})`);
  }
  return r.json();
}

/** Convenience: fetch config + open Picker in one call. */
export async function pickSheetWithBackendToken(): Promise<PickedFile | null> {
  const cfg = await fetchPickerConfig();
  return pickSpreadsheet({
    oauthToken: cfg.access_token,
    apiKey: cfg.api_key,
    title: "Chọn Google Sheet để liên kết",
  });
}

/**
 * Auth context — fetches /api/me on mount and exposes user + workspaces.
 *
 * Falls back gracefully when the server has no OAuth configured (legacy mode):
 * authEnabled becomes false, and pages can simply render the app.
 */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface AuthWorkspace {
  id: number;
  name: string;
  sheet_id: string;
  role: "owner" | "editor" | "viewer";
  is_default: boolean;
}

interface AuthState {
  user: AuthUser | null;
  workspaces: AuthWorkspace[];
  authEnabled: boolean;
  loading: boolean;
  currentWorkspaceId: number | null;
  setCurrentWorkspaceId: (id: number) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

const WORKSPACE_KEY = "thu-chi.workspace";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaces, setWorkspaces] = useState<AuthWorkspace[]>([]);
  const [authEnabled, setAuthEnabled] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<number | null>(() => {
    const v = localStorage.getItem(WORKSPACE_KEY);
    return v ? parseInt(v, 10) : null;
  });

  const setCurrentWorkspaceId = useCallback((id: number) => {
    setCurrentWorkspaceIdState(id);
    localStorage.setItem(WORKSPACE_KEY, String(id));
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch("/auth/status", { credentials: "include" });
      if (r.ok) {
        const j = await r.json();
        setAuthEnabled(!!j.enabled);
        return !!j.enabled;
      }
    } catch {
      // ignore
    }
    return true;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const enabled = await fetchStatus();
      if (!enabled) {
        setUser(null);
        setWorkspaces([]);
        return;
      }
      const r = await fetch("/api/me", { credentials: "include" });
      if (r.status === 401) {
        setUser(null);
        setWorkspaces([]);
        return;
      }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setUser(j.user);
      setWorkspaces(j.workspaces);
      // Pick default workspace if none chosen yet
      if (j.workspaces.length > 0) {
        const stored = localStorage.getItem(WORKSPACE_KEY);
        const ids = new Set<number>(j.workspaces.map((w: AuthWorkspace) => w.id));
        if (!stored || !ids.has(parseInt(stored, 10))) {
          const def = j.workspaces.find((w: AuthWorkspace) => w.is_default) ?? j.workspaces[0];
          setCurrentWorkspaceId(def.id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, setCurrentWorkspaceId]);

  const logout = useCallback(async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setWorkspaces([]);
    localStorage.removeItem(WORKSPACE_KEY);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      workspaces,
      authEnabled,
      loading,
      currentWorkspaceId,
      setCurrentWorkspaceId,
      refresh,
      logout,
    }),
    [user, workspaces, authEnabled, loading, currentWorkspaceId, setCurrentWorkspaceId, refresh, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

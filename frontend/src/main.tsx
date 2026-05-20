import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { AuthProvider, useAuth } from "./auth";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import "./styles.css";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, authEnabled } = useAuth();
  if (loading) return <div className="boot-loading">Đang kiểm tra phiên đăng nhập…</div>;
  if (!authEnabled) return <>{children}</>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireWorkspace({ children }: { children: React.ReactNode }) {
  const { user, workspaces, loading, authEnabled } = useAuth();
  if (!authEnabled) return <>{children}</>;
  if (loading) return <div className="boot-loading">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (workspaces.length === 0) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <Onboarding />
              </RequireAuth>
            }
          />
          <Route
            path="/app/*"
            element={
              <RequireWorkspace>
                <App />
              </RequireWorkspace>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

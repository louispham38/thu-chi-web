import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";

export default function UserMenu() {
  const { user, workspaces, currentWorkspaceId, setCurrentWorkspaceId, authEnabled, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!authEnabled || !user) return null;

  const initials = (user.name || user.email).slice(0, 1).toUpperCase();

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="avatar-btn" onClick={() => setOpen((o) => !o)}>
        {user.picture ? (
          <img src={user.picture} alt={user.name || user.email} />
        ) : (
          <span className="avatar-fallback">{initials}</span>
        )}
      </button>

      {open && (
        <div className="user-dropdown">
          <div className="user-info">
            <strong>{user.name || user.email}</strong>
            <span>{user.email}</span>
          </div>

          {workspaces.length > 1 && (
            <>
              <div className="dropdown-section">Workspace</div>
              {workspaces.map((w) => (
                <button
                  type="button"
                  key={w.id}
                  className={`dropdown-item ${w.id === currentWorkspaceId ? "active" : ""}`}
                  onClick={() => {
                    setCurrentWorkspaceId(w.id);
                    setOpen(false);
                    window.location.reload(); // reload to refetch with new workspace header
                  }}
                >
                  {w.name}
                  <span className="role-tag">{w.role}</span>
                </button>
              ))}
            </>
          )}

          <div className="dropdown-divider" />
          <Link
            to="/workspace/settings"
            className="dropdown-item link"
            onClick={() => setOpen(false)}
          >
            Cài đặt workspace
          </Link>
          <Link
            to="/profile"
            className="dropdown-item link"
            onClick={() => setOpen(false)}
          >
            Tài khoản
          </Link>
          <div className="dropdown-divider" />
          <button
            type="button"
            className="dropdown-item"
            onClick={() => {
              setOpen(false);
              logout().then(() => {
                window.location.href = "/";
              });
            }}
          >
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

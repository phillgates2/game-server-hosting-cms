"use client";

import { useEffect, useState, useCallback } from "react";

interface UserRow {
  id: number;
  username: string;
  email: string;
  role: string;
  status: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  maxServers: number | null;
  twoFactorEnabled: boolean | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  loginCount: number | null;
  createdAt: string;
  serverCount: number;
}

export default function UsersPanel() {
  const [usersList, setUsersList] = useState<UserRow[]>([]);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ role: "", status: "", maxServers: "", email: "", password: "" });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/users${q}`);
      const data = await res.json();
      setUsersList(data.users || []);
    } catch { /* ignore */ } finally { setLoaded(true); }
  }, [search]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  function startEdit(u: UserRow) {
    setEditing(u);
    setEditForm({ role: u.role, status: u.status, maxServers: String(u.maxServers ?? 5), email: u.email, password: "" });
  }

  async function saveEdit() {
    if (!editing) return;
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        role: editForm.role,
        status: editForm.status,
        maxServers: parseInt(editForm.maxServers),
        email: editForm.email,
      };
      if (editForm.password) payload.password = editForm.password;

      const res = await fetch(`/api/users/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Failed" });
      } else {
        setMessage({ type: "success", text: `User "${editing.username}" updated` });
        setEditing(null);
        loadUsers();
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function deleteUser(u: UserRow) {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else { setMessage({ type: "success", text: `User "${u.username}" deleted` }); loadUsers(); }
    } catch { /* ignore */ }
  }

  async function quickAction(id: number, field: string, value: string) {
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    loadUsers();
  }

  const roleBadge = (role: string) => {
    const c = role === "admin" ? "bg-danger/15 text-danger" : role === "moderator" ? "bg-purple/15 text-purple" : "bg-accent/15 text-accent";
    return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${c}`}>{role}</span>;
  };

  const statusBadge = (status: string) => {
    const c = status === "active" ? "bg-success/15 text-success" : status === "suspended" ? "bg-warning/15 text-warning" : "bg-danger/15 text-danger";
    return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${c}`}>{status}</span>;
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">👥 User Management</h2>
          <p className="text-text-secondary text-sm">{usersList.length} registered users</p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm w-56"
          />
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
          {message.text}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={usersList.length} icon="👥" />
        <StatCard label="Admins" value={usersList.filter((u) => u.role === "admin").length} icon="🛡️" />
        <StatCard label="Active" value={usersList.filter((u) => u.status === "active").length} icon="✅" />
        <StatCard label="Suspended" value={usersList.filter((u) => u.status !== "active").length} icon="⚠️" />
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="bg-bg-card border border-accent/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Editing: {editing.username}</h3>
            <button onClick={() => setEditing(null)} className="text-text-muted text-xs hover:text-text-primary">Cancel</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Role</label>
              <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm">
                <option value="user">User</option>
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Status</label>
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm">
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="banned">Banned</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Max Servers</label>
              <input type="number" value={editForm.maxServers} onChange={(e) => setEditForm({ ...editForm, maxServers: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Email</label>
              <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Reset Password</label>
              <input type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="Leave blank to keep" className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" />
            </div>
          </div>
          <button onClick={saveEdit} className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Save Changes</button>
        </div>
      )}

      {/* User list */}
      {!loaded && <div className="text-center py-8"><div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}

      {loaded && usersList.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">User</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Role</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Status</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Servers</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Last Login</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Logins</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Joined</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-bg-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold flex-shrink-0">
                          {u.username[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{u.username}</p>
                          <p className="text-text-muted text-xs truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{roleBadge(u.role)}</td>
                    <td className="px-4 py-3">{statusBadge(u.status)}</td>
                    <td className="px-4 py-3 text-text-muted">{u.serverCount}/{u.maxServers ?? 5}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                      {u.lastLoginIp && <span className="block text-[10px] font-mono">{u.lastLoginIp}</span>}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{u.loginCount ?? 0}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(u)} className="px-2 py-1 bg-accent/15 text-accent rounded text-[10px] font-medium">Edit</button>
                        {u.status === "active" ? (
                          <button onClick={() => quickAction(u.id, "status", "suspended")} className="px-2 py-1 bg-warning/15 text-warning rounded text-[10px] font-medium">Suspend</button>
                        ) : (
                          <button onClick={() => quickAction(u.id, "status", "active")} className="px-2 py-1 bg-success/15 text-success rounded text-[10px] font-medium">Activate</button>
                        )}
                        <button onClick={() => deleteUser(u)} className="px-2 py-1 bg-danger/15 text-danger rounded text-[10px] font-medium">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
      <span className="text-xl">{icon}</span>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-text-muted text-xs">{label}</p>
    </div>
  );
}

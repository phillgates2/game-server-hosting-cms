"use client";

import { useEffect, useState, useCallback } from "react";

interface Role {
  id: number; name: string; displayName: string; color: string | null; icon: string | null;
  isSystem: boolean | null; isDefault: boolean | null; priority: number | null;
  permissions: Record<string, boolean>; userCount: number;
}
interface PermCategory {
  label: string;
  permissions: Record<string, string>;
}

export default function RolesPanel() {
  const [rolesList, setRolesList] = useState<Role[]>([]);
  const [categories, setCategories] = useState<Record<string, PermCategory>>({});
  const [editing, setEditing] = useState<Role | null>(null);
  const [editPerms, setEditPerms] = useState<Record<string, boolean>>({});
  const [editFields, setEditFields] = useState({ displayName: "", color: "#3b82f6", icon: "👤", priority: "0" });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", displayName: "", color: "#3b82f6", icon: "👤", priority: "0" });
  const [createPerms, setCreatePerms] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadRoles = useCallback(async () => {
    try {
      const res = await fetch("/api/roles");
      const data = await res.json();
      setRolesList(data.roles || []);
      setCategories(data.categories || {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  function startEdit(role: Role) {
    setEditing(role);
    setEditPerms({ ...(role.permissions || {}) });
    setEditFields({ displayName: role.displayName, color: role.color || "#3b82f6", icon: role.icon || "👤", priority: String(role.priority ?? 0) });
    setShowCreate(false);
  }

  async function saveEdit() {
    if (!editing) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/roles/${editing.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editFields, priority: parseInt(editFields.priority), permissions: editPerms }),
      });
      if (!res.ok) { const d = await res.json(); setMessage({ type: "error", text: d.error }); return; }
      setMessage({ type: "success", text: `Role "${editFields.displayName}" updated` });
      setEditing(null); loadRoles();
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const res = await fetch("/api/roles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...createForm, priority: parseInt(createForm.priority), permissions: createPerms }),
      });
      if (!res.ok) { const d = await res.json(); setMessage({ type: "error", text: d.error }); return; }
      setMessage({ type: "success", text: "Role created" });
      setShowCreate(false); setCreateForm({ name: "", displayName: "", color: "#3b82f6", icon: "👤", priority: "0" }); setCreatePerms({});
      loadRoles();
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  async function deleteRole(id: number) {
    if (!confirm("Delete this role?")) return;
    const res = await fetch(`/api/roles/${id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); setMessage({ type: "error", text: d.error }); return; }
    setMessage({ type: "success", text: "Role deleted" }); loadRoles();
  }

  function PermGrid({ perms, onChange }: { perms: Record<string, boolean>; onChange: (p: Record<string, boolean>) => void }) {
    function toggleAll(catPerms: string[], val: boolean) {
      const next = { ...perms };
      catPerms.forEach((p) => { next[p] = val; });
      onChange(next);
    }
    return (
      <div className="space-y-4">
        {Object.entries(categories).map(([catKey, cat]) => {
          const permKeys = Object.keys(cat.permissions);
          const allChecked = permKeys.every((p) => perms[p]);
          return (
            <div key={catKey} className="bg-bg-secondary rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">{cat.label}</h4>
                <button type="button" onClick={() => toggleAll(permKeys, !allChecked)} className="text-[10px] text-accent hover:underline">
                  {allChecked ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {Object.entries(cat.permissions).map(([perm, desc]) => (
                  <label key={perm} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-bg-hover cursor-pointer">
                    <input type="checkbox" checked={!!perms[perm]} onChange={(e) => onChange({ ...perms, [perm]: e.target.checked })} className="rounded" />
                    <span className="text-text-secondary">{desc}</span>
                    <span className="text-[9px] text-text-muted font-mono ml-auto">{perm}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🔑 Roles & Permissions</h2>
          <p className="text-text-secondary text-sm">Create and manage roles with granular permission control</p>
        </div>
        <button onClick={() => { setShowCreate(!showCreate); setEditing(null); }} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">
          {showCreate ? "Cancel" : "+ New Role"}
        </button>
      </div>

      {message && <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>{message.text}</div>}

      {/* Create */}
      {showCreate && (
        <form onSubmit={createRole} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Create Role</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label className="block text-xs text-text-muted mb-1">Internal Name *</label><input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required placeholder="vip" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Display Name *</label><input value={createForm.displayName} onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required placeholder="VIP Member" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Color</label><div className="flex gap-2"><input type="color" value={createForm.color} onChange={(e) => setCreateForm({ ...createForm, color: e.target.value })} className="w-10 h-10 rounded cursor-pointer bg-transparent border-0" /><input value={createForm.color} onChange={(e) => setCreateForm({ ...createForm, color: e.target.value })} className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono" /></div></div>
            <div><label className="block text-xs text-text-muted mb-1">Priority</label><input type="number" value={createForm.priority} onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
          </div>
          <h4 className="font-medium text-sm pt-2">Permissions</h4>
          <PermGrid perms={createPerms} onChange={setCreatePerms} />
          <button type="submit" className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Create Role</button>
        </form>
      )}

      {/* Edit */}
      {editing && (
        <div className="bg-bg-card border border-accent/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Editing: {editing.displayName} {editing.isSystem ? <span className="text-xs text-text-muted">(system)</span> : ""}</h3>
            <button onClick={() => setEditing(null)} className="text-text-muted text-xs">Cancel</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label className="block text-xs text-text-muted mb-1">Display Name</label><input value={editFields.displayName} onChange={(e) => setEditFields({ ...editFields, displayName: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Color</label><div className="flex gap-2"><input type="color" value={editFields.color} onChange={(e) => setEditFields({ ...editFields, color: e.target.value })} className="w-10 h-10 rounded cursor-pointer bg-transparent border-0" /><input value={editFields.color} onChange={(e) => setEditFields({ ...editFields, color: e.target.value })} className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono" /></div></div>
            <div><label className="block text-xs text-text-muted mb-1">Icon</label><input value={editFields.icon} onChange={(e) => setEditFields({ ...editFields, icon: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Priority</label><input type="number" value={editFields.priority} onChange={(e) => setEditFields({ ...editFields, priority: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
          </div>
          <h4 className="font-medium text-sm pt-2">Permissions</h4>
          <PermGrid perms={editPerms} onChange={setEditPerms} />
          <button onClick={saveEdit} className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Save Changes</button>
        </div>
      )}

      {/* Roles list */}
      <div className="grid gap-3">
        {rolesList.map((role) => (
          <div key={role.id} className="bg-bg-card border border-border rounded-xl p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl" style={{ backgroundColor: `${role.color}20` }}>
                {role.icon || "👤"}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold" style={{ color: role.color || "#3b82f6" }}>{role.displayName}</span>
                  {role.isSystem && <span className="text-[10px] bg-bg-secondary text-text-muted px-1.5 py-0.5 rounded">System</span>}
                  {role.isDefault && <span className="text-[10px] bg-success/15 text-success px-1.5 py-0.5 rounded">Default</span>}
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  <span className="font-mono">{role.name}</span> · {role.userCount} users · Priority {role.priority} · {Object.values(role.permissions || {}).filter(Boolean).length} permissions
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(role)} className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs font-medium">Edit</button>
              {!role.isSystem && (
                <button onClick={() => deleteRole(role.id)} className="px-3 py-1.5 bg-danger/15 text-danger rounded-lg text-xs font-medium">Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

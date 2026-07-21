"use client";

import { useEffect, useState, useCallback } from "react";

interface Profile {
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
}

interface MyServer {
  id: number;
  name: string;
  status: string;
}

export default function ProfilePanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [serverCount, setServerCount] = useState(0);
  const [postCount, setPostCount] = useState(0);
  const [servers, setServers] = useState<MyServer[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ email: "", bio: "", location: "", website: "" });
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showPwChange, setShowPwChange] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/profile");
      const data = await res.json();
      if (data.profile) {
        setProfile(data.profile);
        setServerCount(data.serverCount || 0);
        setPostCount(data.postCount || 0);
        setServers(data.servers || []);
        setForm({
          email: data.profile.email,
          bio: data.profile.bio || "",
          location: data.profile.location || "",
          website: data.profile.website || "",
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Failed" });
      } else {
        setMessage({ type: "success", text: "Profile updated" });
        setEditMode(false);
        loadProfile();
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setLoading(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match" });
      return;
    }
    if (pwForm.newPassword.length < 6) {
      setMessage({ type: "error", text: "Password must be at least 6 characters" });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Failed" });
      } else {
        setMessage({ type: "success", text: "Password changed successfully" });
        setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        setShowPwChange(false);
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setLoading(false);
    }
  }

  if (!profile) {
    return <div className="text-center py-12"><div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  const roleBadge = profile.role === "admin" ? "bg-danger/15 text-danger" : profile.role === "moderator" ? "bg-purple/15 text-purple" : "bg-accent/15 text-accent";

  return (
    <div className="animate-fade-in space-y-6 max-w-4xl">
      <h2 className="text-2xl font-bold">👤 My Profile</h2>

      {message && (
        <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
          {message.text}
        </div>
      )}

      {/* Profile card */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <div className="flex items-start gap-6">
          <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center text-accent text-3xl font-bold flex-shrink-0">
            {profile.username[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-xl font-bold">{profile.username}</h3>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${roleBadge}`}>{profile.role}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${profile.status === "active" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{profile.status}</span>
            </div>
            <p className="text-text-muted text-sm">{profile.email}</p>
            {profile.bio && <p className="text-text-secondary text-sm mt-2">{profile.bio}</p>}
            <div className="flex gap-4 mt-3 text-xs text-text-muted">
              {profile.location && <span>📍 {profile.location}</span>}
              {profile.website && <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">🔗 {profile.website}</a>}
            </div>
          </div>
          <button onClick={() => setEditMode(!editMode)} className="px-4 py-2 bg-accent/15 text-accent rounded-lg text-sm font-medium">
            {editMode ? "Cancel" : "Edit Profile"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniStat label="Servers" value={`${serverCount}/${profile.maxServers ?? 5}`} icon="🎮" />
        <MiniStat label="Forum Posts" value={String(postCount)} icon="💬" />
        <MiniStat label="Logins" value={String(profile.loginCount ?? 0)} icon="🔑" />
        <MiniStat label="Member Since" value={new Date(profile.createdAt).toLocaleDateString()} icon="📅" />
      </div>

      {/* Edit form */}
      {editMode && (
        <form onSubmit={saveProfile} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Edit Profile</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Email</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" placeholder="City, Country" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Website</label>
              <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" placeholder="https://..." />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Bio</label>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm resize-y" placeholder="Tell us about yourself..." />
          </div>
          <button type="submit" disabled={loading} className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            {loading ? "Saving..." : "Save Profile"}
          </button>
        </form>
      )}

      {/* Password change */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <button onClick={() => setShowPwChange(!showPwChange)} className="flex items-center gap-2 text-sm font-medium text-text-primary">
          🔒 Change Password <span className="text-text-muted text-xs">{showPwChange ? "▼" : "▶"}</span>
        </button>
        {showPwChange && (
          <form onSubmit={changePassword} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">Current Password</label>
                <input type="password" value={pwForm.currentPassword} onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">New Password</label>
                <input type="password" value={pwForm.newPassword} onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Confirm New Password</label>
                <input type="password" value={pwForm.confirmPassword} onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required />
              </div>
            </div>
            <button type="submit" disabled={loading} className="px-6 py-2 bg-warning/80 hover:bg-warning text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? "Changing..." : "Change Password"}
            </button>
          </form>
        )}
      </div>

      {/* My servers */}
      {servers.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-4">🎮 My Servers ({servers.length})</h3>
          <div className="space-y-2">
            {servers.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-bg-secondary rounded-lg p-3">
                <span className="font-medium text-sm">{s.name}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.status === "running" ? "bg-success/15 text-success" : "bg-bg-tertiary text-text-muted"}`}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Security info */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4">🔐 Security</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-text-muted text-xs mb-1">Two-Factor Authentication</p>
            <p className={profile.twoFactorEnabled ? "text-success" : "text-text-muted"}>{profile.twoFactorEnabled ? "✅ Enabled" : "❌ Not enabled"}</p>
          </div>
          <div>
            <p className="text-text-muted text-xs mb-1">Last Login</p>
            <p>{profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : "—"}</p>
          </div>
          <div>
            <p className="text-text-muted text-xs mb-1">Last Login IP</p>
            <p className="font-mono text-xs">{profile.lastLoginIp || "—"}</p>
          </div>
          <div>
            <p className="text-text-muted text-xs mb-1">Total Logins</p>
            <p>{profile.loginCount ?? 0}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <span className="text-text-muted text-xs">{label}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

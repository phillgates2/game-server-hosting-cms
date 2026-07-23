"use client";

import { useState } from "react";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface Props {
  onLogin: (user: AuthUser) => void;
}

export default function LoginForm({ onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = mode === "login" ? { username: form.username, password: form.password } : form;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Authentication failed");
      else onLogin(data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in space-y-5">
        <div className="text-center">
          <div className="inline-block">
            <h1 className="text-4xl font-bold mb-2">🎮</h1>
            <h2 className="text-2xl font-bold text-text-primary">GameServer Manager</h2>
          </div>
          <p className="text-text-secondary text-sm mt-1">
            {mode === "login" ? "Sign in to manage your servers" : "Create your account to access the panel"}
          </p>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl overflow-hidden shadow-2xl">
          <div className="grid grid-cols-2">
            <button onClick={() => setMode("login")} className={`py-3 text-sm font-medium transition-colors ${mode === "login" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted hover:text-text-primary"}`}>
              Sign In
            </button>
            <button onClick={() => setMode("register")} className={`py-3 text-sm font-medium transition-colors ${mode === "register" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted hover:text-text-primary"}`}>
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {mode === "register" && (
              <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 text-xs text-text-secondary">
                <p className="font-medium text-text-primary mb-1">First account tip</p>
                <p>The first account created after installation becomes the main administrator automatically.</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                required
                placeholder={mode === "login" ? "Enter your username" : "Choose a username"}
              />
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                  placeholder="you@example.com"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-text-secondary">Password</label>
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-xs text-accent hover:underline">
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                required
                placeholder={mode === "login" ? "Enter your password" : "Choose a strong password"}
                minLength={mode === "register" ? 6 : undefined}
              />
              {mode === "register" && <p className="text-[10px] text-text-muted mt-1">Use at least 6 characters.</p>}
            </div>

            {error && (
              <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-lg p-3">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="w-full py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-4 text-xs text-text-muted space-y-1">
          <p className="font-medium text-text-primary">Need help?</p>
          <p>1. Install a game template in <strong>Games</strong>.</p>
          <p>2. Add a machine in <strong>Nodes</strong>.</p>
          <p>3. Create a server in <strong>Servers</strong>.</p>
        </div>
      </div>
    </div>
  );
}

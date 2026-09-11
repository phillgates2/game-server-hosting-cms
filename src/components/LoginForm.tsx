"use client";

import { useEffect, useRef, useState } from "react";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface Props {
  onLogin: (user: AuthUser) => void;
}

type Mode = "login" | "register" | "forgot" | "reset";

export default function LoginForm({ onLogin }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [form, setForm] = useState({ username: "", email: "", password: "", dateOfBirth: "", accessKey: "" });
  // When the operator enables the CD-key gate, login/register also need a key.
  const [gateRequired, setGateRequired] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Set once the server reports the account has 2FA enabled, which reveals the
  // code field and keeps it visible while the user retries.
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // Password-reset state.
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // "Sign in with Discord" is only shown when an OAuth app is configured.
  const [discordOAuth, setDiscordOAuth] = useState(false);

  // Read the URL once (reset tokens, OAuth outcomes, OAuth availability).
  // Deferred like the rest of the panel's mount-time reads: the lint rule
  // rightly rejects synchronous setState straight inside an effect.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const timer = window.setTimeout(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset");
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      setResetToken(token);
      setMode("reset");
    }

    // Discord OAuth outcomes land as /?oauth=<code> from the callback route.
    const oauth = params.get("oauth");
    if (oauth) {
      const messages: Record<string, string> = {
        ok: "Signed in with Discord.",
        denied: "Discord sign-in was cancelled.",
        error: "Discord sign-in failed. Try again, or use your password.",
        not_configured: "Discord sign-in is not configured on this panel.",
        no_email: "Your Discord account has no verified email address, so it cannot sign in here.",
        suspended: "That account is suspended or banned.",
        "2fa": "That account has two-factor authentication enabled — sign in with your password and a code instead.",
        no_register: "Self-registration is disabled on this panel, so no new account was created.",
        gate_required: "This panel requires an access key. Enter yours below to sign in.",
        age_gate: "New accounts must register with a date of birth (Australian minimum-age law). Discord sign-in only works for existing accounts.",
      };
      const msg = messages[oauth] ?? "Discord sign-in failed.";
      if (oauth === "ok") setNotice(msg); else setError(msg);
      window.history.replaceState({}, "", window.location.pathname);
    }

    fetch("/api/auth/discord/config")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setDiscordOAuth(Boolean(d.enabled)))
      .catch(() => setDiscordOAuth(false));

    fetch("/api/auth/access-gate")
      .then((r) => (r.ok ? r.json() : { required: false }))
      .then((d) => setGateRequired(Boolean(d.required)))
      .catch(() => setGateRequired(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      mode === "login"
        ? { username: form.username, password: form.password, ...(twoFactorCode ? { twoFactorCode } : {}), ...(gateRequired ? { accessKey: form.accessKey } : {}) }
        : { ...form, ...(gateRequired ? {} : { accessKey: undefined }) };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.twoFactorRequired) {
          setTwoFactorRequired(true);
          setTwoFactorCode("");
        }
        setError(data.error || "Authentication failed");
      } else {
        setTwoFactorRequired(false);
        setTwoFactorCode("");
        onLogin(data.user);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: forgotIdentifier }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not send the reset email.");
      } else {
        setNotice(data.message || "If that account exists, a reset link has been sent.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: newPassword, ...(gateRequired ? { accessKey: form.accessKey } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not reset the password.");
      } else {
        setNotice("Password updated — sign in with your new password.");
        setMode("login");
        setForm((f) => ({ ...f, password: "" }));
        setResetToken("");
        setNewPassword("");
        // Drop the one-time token from the address bar.
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const heading =
    mode === "login" ? "Sign in to manage your servers"
    : mode === "register" ? "Create your account to access the panel"
    : mode === "forgot" ? "Get a password reset link"
    : "Choose a new password";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in space-y-5">
        <div className="text-center">
          <div className="inline-block">
            <h1 className="text-4xl font-bold mb-2">🎮</h1>
            <h2 className="text-2xl font-bold text-text-primary">GameServer Manager</h2>
          </div>
          <p className="text-text-secondary text-sm mt-1">{heading}</p>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl overflow-hidden shadow-2xl">
          {(mode === "login" || mode === "register") && (
            <div className="grid grid-cols-2">
              <button onClick={() => { setMode("login"); setError(""); setNotice(""); }} className={`py-3 text-sm font-medium transition-colors ${mode === "login" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted hover:text-text-primary"}`}>
                Sign In
              </button>
              <button onClick={() => { setMode("register"); setError(""); setNotice(""); }} className={`py-3 text-sm font-medium transition-colors ${mode === "register" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted hover:text-text-primary"}`}>
                Register
              </button>
            </div>
          )}

          {(mode === "login" || mode === "register") && (
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {mode === "register" && (
                <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 text-xs text-text-secondary">
                  <p className="font-medium text-text-primary mb-1">First account tip</p>
                  <p>The first account created after installation becomes the main administrator automatically.</p>
                </div>
              )}

              {gateRequired && (mode === "login" || mode === "register") && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">🔑 Panel access key</label>
                  <input
                    type="text"
                    value={form.accessKey}
                    onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="GSM-XXXX-XXXX-XXXX-XXXX"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-xs text-text-muted mt-1">This panel is protected — ask the operator for a key.</p>
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

              {mode === "register" && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Date of birth</label>
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    required
                    autoComplete="bday"
                    max={new Date().toISOString().slice(0, 10)}
                  />
                  <p className="text-[10px] text-text-muted mt-1">
                    Australian law (Online Safety Amendment Act 2024) requires you to be at least 16 to hold an account.
                  </p>
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
                {mode === "login" && (
                  <button type="button" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }} className="text-xs text-accent hover:underline mt-1">
                    Forgot your password?
                  </button>
                )}
              </div>

              {mode === "login" && twoFactorRequired && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Two-Factor Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary tracking-[0.4em] text-center font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="000000"
                    autoFocus
                    required
                  />
                  <p className="text-[10px] text-text-muted mt-1">Enter the 6-digit code from your authenticator app.</p>
                </div>
              )}

              {error && (
                <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-lg p-3">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="w-full py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
                {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
              </button>

              {mode === "login" && discordOAuth && (
                <>
                  <div className="flex items-center gap-3 text-[10px] text-text-muted">
                    <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
                  </div>
                  <a
                    href={`/api/auth/discord${gateRequired && form.accessKey.trim() ? `?accessKey=${encodeURIComponent(form.accessKey.trim())}` : ""}`}
                    className="block w-full py-3 text-center bg-[#5865F2] hover:opacity-90 text-white rounded-lg font-medium transition-opacity"
                  >
                    Sign in with Discord
                  </a>
                </>
              )}
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={handleForgot} className="p-6 space-y-4">
              <div className="bg-bg-secondary border border-border rounded-lg p-3 text-xs text-text-secondary">
                <p>Enter your <strong>username or email address</strong>. If the account exists, a one-time reset link (valid for one hour) will be emailed to it.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Username or email</label>
                <input
                  type="text"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                  placeholder="you, or you@example.com"
                />
              </div>
              {error && <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-lg p-3">{error}</div>}
              {notice && <div className="bg-success/10 border border-success/30 text-success text-sm rounded-lg p-3">{notice}</div>}
              <button type="submit" disabled={loading} className="w-full py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
                {loading ? "Please wait..." : "Send Reset Link"}
              </button>
              <button type="button" onClick={() => { setMode("login"); setError(""); setNotice(""); }} className="w-full py-2 text-sm text-text-muted hover:text-text-primary transition-colors">
                ← Back to sign in
              </button>
            </form>
          )}

          {mode === "reset" && (
            <form onSubmit={handleReset} className="p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-text-secondary">New password</label>
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-xs text-accent hover:underline">
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                  minLength={8}
                  placeholder="Choose a new password"
                  autoFocus
                />
                <p className="text-[10px] text-text-muted mt-1">At least 8 characters. The link works once.</p>
              </div>
              {error && <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-lg p-3">{error}</div>}
              <button type="submit" disabled={loading || newPassword.length < 8} className="w-full py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
                {loading ? "Please wait..." : "Set New Password"}
              </button>
              <button type="button" onClick={() => { setMode("login"); setError(""); setNotice(""); }} className="w-full py-2 text-sm text-text-muted hover:text-text-primary transition-colors">
                ← Back to sign in
              </button>
            </form>
          )}
        </div>

        {notice && mode === "login" && (
          <div className="bg-success/10 border border-success/30 text-success text-sm rounded-xl p-3">
            {notice}
          </div>
        )}

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

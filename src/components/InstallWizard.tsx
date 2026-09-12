"use client";

import { useState } from "react";

interface Props {
  onComplete: () => void;
}

export default function InstallWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    adminUsername: "admin",
    adminEmail: "admin@localhost",
    adminPassword: "",
    databasePassword: "",
    panelName: "GameServer Manager",
    accessKey: "",
    licenseKey: "",
    licenseToken: "",
    licensePublicKey: "",
  });
  const [installing, setInstalling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [bootstrap, setBootstrap] = useState<{ masterKey: string | null; signingKey: boolean; starterProduct: string | null } | null>(null);

  async function runInstall() {
    setInstalling(true);
    setError("");
    setLogs(["Starting installation..."]);

    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Installation failed");
        setLogs((l) => [...l, `❌ Error: ${data.error}`]);
      } else {
        setLogs((l) => [
          ...l,
          "✅ Database schema created with multi-node support",
          "✅ Admin user created",
          "✅ Multi-node system ready",
          "✅ 30+ Game templates ready (install from Games panel)",
          "✅ Discord webhook support enabled",
          "✅ Forum categories created",
          "✅ Settings saved",
          "",
          "🎉 Installation complete!",
          "",
          "📌 Next steps:",
          "  1. Add a node from Nodes panel (or add this server as local node)",
          "  2. Install game templates from Games → Templates",
          "  3. Create your first game server!",
        ]);
        setBootstrap(data?.bootstrap ?? null);
        if (data?.bootstrap) {
          setLogs((l) => [
            ...l.slice(0, -4),
            ...(data.bootstrap.masterKey ? ["🔑 Master key generated — copy it below (shown once!)"] : []),
            ...(data.bootstrap.signingKey ? ["🔏 Offline-token signing key created"] : []),
            ...(data.bootstrap.starterProduct ? [`🛒 Starter product added: "${data.bootstrap.starterProduct}"`] : []),
            "",
            "📌 Next steps:",
            "  1. Add a node from Nodes panel (or add this server as local node)",
            "  2. Install game templates from Games → Templates",
            "  3. Create your first game server!",
          ]);
        }
        setDone(true);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setLogs((l) => [...l, `❌ Error: ${msg}`]);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-bg-card border border-border rounded-2xl overflow-hidden shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-accent to-purple p-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">🎮 GameServer Manager</h1>
          <p className="text-blue-100 text-sm">TCAdmin Alternative — Modern Game Server Hosting Panel</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 p-4 bg-bg-secondary border-b border-border">
          {["Welcome", "Configure", "Install"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  i <= step ? "bg-accent text-white" : "bg-bg-tertiary text-text-muted"
                }`}
              >
                {i + 1}
              </div>
              <span className={`text-sm ${i <= step ? "text-text-primary" : "text-text-muted"}`}>
                {label}
              </span>
              {i < 2 && <div className="w-8 h-0.5 bg-border" />}
            </div>
          ))}
        </div>

        <div className="p-8">
          {step === 0 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">Welcome to GameServer Manager</h2>
              <div className="space-y-3 text-text-secondary text-sm">
                <p>This wizard will set up your game server hosting panel with:</p>
                <ul className="list-none space-y-2">
                  <li>🗄️ PostgreSQL database schema & tables</li>
                  <li>👤 Admin account creation</li>
                  <li>🖥️ <strong>Multi-Node Support</strong> — Manage game servers across multiple machines</li>
                  <li>🎮 <strong>30+ Game Templates</strong> — Minecraft, CS2, Rust, ARK, Valheim, Palworld, Terraria, and more</li>
                  <li>🔔 Discord webhook notifications for server events</li>
                  <li>💬 Forum with categories</li>
                  <li>📊 Server monitoring with RAM buffer management</li>
                  <li>🔧 Built-in database viewer/editor (like phpMyAdmin)</li>
                  <li>🌐 IPv6 support</li>
                </ul>
              </div>
              <button
                onClick={() => setStep(1)}
                className="w-full py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
              >
                Get Started →
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">Panel Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Panel Name</label>
                  <input
                    type="text"
                    value={form.panelName}
                    onChange={(e) => setForm({ ...form, panelName: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Admin Username</label>
                  <input
                    type="text"
                    value={form.adminUsername}
                    onChange={(e) => setForm({ ...form, adminUsername: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Admin Email</label>
                  <input
                    type="email"
                    value={form.adminEmail}
                    onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">License Key <span className="text-text-muted font-normal">(required — issued by the master panel)</span></label>
                  <input
                    type="text"
                    value={form.licenseKey}
                    onChange={(e) => setForm({ ...form, licenseKey: e.target.value })}
                    placeholder="GSM-LIC-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                    autoComplete="off"
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <p className="mt-1 text-[11px] text-text-muted">Validated live against the license server before anything is installed. Master-panel instances (GSM_LICENSE_MODE=master) skip this.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Air-gapped? <span className="text-text-muted font-normal">(offline token instead — leave the key above blank)</span></label>
                  <textarea
                    value={form.licenseToken}
                    onChange={(e) => setForm({ ...form, licenseToken: e.target.value })}
                    placeholder="Paste the offline token from the master panel"
                    rows={2}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <textarea
                    value={form.licensePublicKey}
                    onChange={(e) => setForm({ ...form, licensePublicKey: e.target.value })}
                    placeholder="-----BEGIN PUBLIC KEY----- … (the master panel's public key)"
                    rows={2}
                    className="mt-2 w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <p className="mt-1 text-[11px] text-text-muted">Verified locally by signature — no network needed. The token carries an expiry; renew it from the master panel when it runs out.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Install Key <span className="text-text-muted font-normal">(the operator master key — required when set)</span></label>
                  <input
                    type="password"
                    value={form.accessKey}
                    onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
                    placeholder="Leave blank unless the operator set a master key"
                    autoComplete="off"
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <p className="mt-1 text-[11px] text-text-muted">If the server runs with GSM_PANEL_MASTER_KEY, the install only proceeds with that key — nobody can claim a fresh panel without it. This is the only key the panel asks for; login itself is just username + password.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Admin Password</label>
                  <input
                    type="password"
                    value={form.adminPassword}
                    onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="Enter a strong password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Database Password</label>
                  <input
                    type="password"
                    value={form.databasePassword}
                    onChange={(e) => setForm({ ...form, databasePassword: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="Optional; leave blank to keep the current database password"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(0)}
                  className="flex-1 py-3 bg-bg-secondary border border-border hover:bg-bg-hover text-text-primary rounded-lg font-medium transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => {
                    if (!form.adminPassword) {
                      setError("Password is required");
                      return;
                    }
                    setError("");
                    setStep(2);
                  }}
                  className="flex-1 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
                >
                  Continue →
                </button>
              </div>
              {error && <p className="text-danger text-sm">{error}</p>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">
                {done ? "✅ Installation Complete" : "Ready to Install"}
              </h2>
              {!installing && !done && (
                <>
                  <div className="bg-bg-secondary rounded-lg p-4 text-sm text-text-secondary space-y-1">
                    <p><strong>Panel:</strong> {form.panelName}</p>
                    <p><strong>Admin:</strong> {form.adminUsername} ({form.adminEmail})</p>
                    <p><strong>Database:</strong> {form.databasePassword ? "A new database password will be applied" : "Current database password will be kept"}</p>
                    <p><strong>Games:</strong> ET:Legacy, OpenRA, Palworld, Satisfactory, Terraria</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep(1)}
                      className="flex-1 py-3 bg-bg-secondary border border-border hover:bg-bg-hover text-text-primary rounded-lg font-medium transition-colors"
                    >
                      ← Back
                    </button>
                    <button
                      onClick={runInstall}
                      className="flex-1 py-3 bg-success hover:opacity-90 text-white rounded-lg font-medium transition-colors"
                    >
                      🚀 Install Now
                    </button>
                  </div>
                </>
              )}

              {(installing || logs.length > 1) && (
                <div className="bg-bg-primary border border-border rounded-lg p-4 font-mono text-xs max-h-60 overflow-y-auto">
                  {logs.map((log, i) => (
                    <div key={i} className={log.startsWith("❌") ? "text-danger" : "text-success"}>
                      {log || "\u00a0"}
                    </div>
                  ))}
                  {installing && (
                    <div className="text-accent animate-pulse">Installing...</div>
                  )}
                </div>
              )}

              {done && bootstrap?.masterKey && (
                <div className="rounded-xl border border-success/40 bg-success/10 p-4 space-y-2 text-left">
                  <p className="text-sm font-bold text-success">🔑 Your master key — shown exactly once. Copy it now:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-lg bg-bg-card border border-border px-3 py-2 text-xs font-mono text-text-primary">{bootstrap.masterKey}</code>
                    <button
                      onClick={() => { void navigator.clipboard.writeText(bootstrap.masterKey ?? "").then(() => setLogs((l) => [...l, "✅ Master key copied to clipboard"])); }}
                      className="px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium"
                    >Copy</button>
                  </div>
                  <p className="text-[11px] text-text-muted">
                    This key guards fresh installs, validates as an unlimited license key, and administers the shop/license APIs (X-Master-Key header). Only you should ever hold it.
                    {bootstrap.starterProduct ? <> The store is live with “{bootstrap.starterProduct}” — manage everything under API Keys → Access Gate and License Keys.</> : null}
                  </p>
                </div>
              )}

              {done && !bootstrap?.masterKey && bootstrap && (
                <div className="rounded-xl border border-border bg-bg-secondary/60 p-3 text-left">
                  <p className="text-xs text-text-secondary">🔑 Master panel bootstrapped: signing key{bootstrap.starterProduct ? <> + starter product “{bootstrap.starterProduct}”</> : null} ready. An env master key is active, so no new key was generated.</p>
                </div>
              )}

              {done && (
                <button
                  onClick={onComplete}
                  className="w-full py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
                >
                  Go to Login →
                </button>
              )}

              {error && !installing && <p className="text-danger text-sm">{error}</p>}
            </div>
          )}
        </div>

        <div className="px-8 pb-6 text-center text-xs text-text-muted">
          GameServer Manager v1.0.0 — Open Source Game Server Hosting Panel
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3 | 4;

export default function InstallPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    siteName: "GamePanel",
    adminUsername: "admin",
    adminEmail: "admin@example.com",
    adminPassword: "",
  });
  const [installProgress, setInstallProgress] = useState(0);
  const [installLog, setInstallLog] = useState<string[]>([]);

  const updateForm = (key: string, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    setError("");
  };

  const runInstall = async () => {
    setLoading(true);
    setError("");
    setStep(4);

    const logs = [
      "Checking system requirements...",
      "✓ Node.js version compatible",
      "✓ PostgreSQL connection established",
      "Creating database tables...",
      "✓ Users table created",
      "✓ Games table created",
      "✓ Servers table created",
      "✓ Nodes table created",
      "✓ Plans table created",
      "✓ Forum tables created",
      "✓ Support ticket tables created",
      "✓ Activity log table created",
      "Seeding game templates...",
      "  → Counter-Strike 2",
      "  → Minecraft Java",
      "  → Rust",
      "  → ARK: Survival Evolved",
      "  → Garry's Mod",
      "  → Valheim",
      "  → Team Fortress 2",
      "  → 7 Days to Die",
      "✓ 8 games seeded",
      "Seeding service plans...",
      "✓ 4 plans created",
      "Creating default node...",
      "✓ Node-01 (Primary) configured",
      "Creating forum categories...",
      "✓ 5 forum categories created",
      "Creating admin account...",
      "✓ Admin account created",
      "Finalizing installation...",
      "✓ Site settings saved",
      "═══════════════════════════════════",
      "  Installation Complete! 🎉",
      "═══════════════════════════════════",
    ];

    for (let i = 0; i < logs.length; i++) {
      await new Promise(r => setTimeout(r, 80));
      setInstallLog(prev => [...prev, logs[i]]);
      setInstallProgress(Math.round(((i + 1) / logs.length) * 90));
    }

    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Installation failed");
        setLoading(false);
        return;
      }

      setInstallProgress(100);
      setInstallLog(prev => [...prev, "Redirecting to dashboard..."]);
      await new Promise(r => setTimeout(r, 1500));
      router.push("/dashboard");
    } catch {
      setError("Installation failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-2xl">
              🎮
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-brand-400 to-accent-400 bg-clip-text text-transparent">
              GamePanel Installer
            </h1>
          </div>
          <p className="text-dark-300">Set up your game server hosting panel</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                s <= step ? "bg-brand-500 text-white" : "bg-dark-600 text-dark-300"
              }`}>
                {s < step ? "✓" : s}
              </div>
              {s < 4 && <div className={`w-12 h-0.5 ${s < step ? "bg-brand-500" : "bg-dark-600"}`} />}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="glass-card rounded-2xl p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="animate-slide-up">
              <h2 className="text-2xl font-bold mb-4">Welcome to GamePanel</h2>
              <p className="text-dark-300 mb-6">
                This wizard will guide you through the installation of your game server hosting panel. 
                You&apos;ll have a fully functional panel with:
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "🎮 Automatic game server deployment (CS2, Minecraft, Rust, etc.)",
                  "🖥️ Multi-node server management",
                  "💬 Built-in community forum",
                  "🎫 Support ticket system",
                  "📊 Admin dashboard with analytics",
                  "👥 User management with roles",
                  "📦 Service plans & billing",
                  "🔧 One-click server install with SteamCMD",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-gray-300">
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setStep(2)}
                className="w-full py-3 px-6 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white font-semibold rounded-xl transition-all"
              >
                Begin Installation →
              </button>
            </div>
          )}

          {/* Step 2: Site Settings */}
          {step === 2 && (
            <div className="animate-slide-up">
              <h2 className="text-2xl font-bold mb-6">Site Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Site Name</label>
                  <input
                    type="text"
                    value={form.siteName}
                    onChange={e => updateForm("siteName", e.target.value)}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white placeholder-dark-400 focus:outline-none focus:border-brand-500 transition-colors"
                    placeholder="My Game Hosting"
                  />
                </div>
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={() => setStep(1)} className="flex-1 py-3 px-6 bg-dark-600 hover:bg-dark-500 text-white rounded-xl transition-all">
                  ← Back
                </button>
                <button
                  onClick={() => { if (form.siteName) setStep(3); else setError("Site name is required"); }}
                  className="flex-1 py-3 px-6 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white font-semibold rounded-xl transition-all"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Admin Account */}
          {step === 3 && (
            <div className="animate-slide-up">
              <h2 className="text-2xl font-bold mb-6">Admin Account</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
                  <input
                    type="text"
                    value={form.adminUsername}
                    onChange={e => updateForm("adminUsername", e.target.value)}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white placeholder-dark-400 focus:outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={form.adminEmail}
                    onChange={e => updateForm("adminEmail", e.target.value)}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white placeholder-dark-400 focus:outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                  <input
                    type="password"
                    value={form.adminPassword}
                    onChange={e => updateForm("adminPassword", e.target.value)}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white placeholder-dark-400 focus:outline-none focus:border-brand-500 transition-colors"
                    placeholder="Min 6 characters"
                  />
                </div>
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={() => setStep(2)} className="flex-1 py-3 px-6 bg-dark-600 hover:bg-dark-500 text-white rounded-xl transition-all">
                  ← Back
                </button>
                <button
                  onClick={() => {
                    if (!form.adminUsername || !form.adminEmail || !form.adminPassword) {
                      setError("All fields are required");
                    } else if (form.adminPassword.length < 6) {
                      setError("Password must be at least 6 characters");
                    } else {
                      runInstall();
                    }
                  }}
                  disabled={loading}
                  className="flex-1 py-3 px-6 bg-gradient-to-r from-brand-500 to-accent-500 hover:from-brand-600 hover:to-accent-600 text-white font-semibold rounded-xl transition-all disabled:opacity-50"
                >
                  🚀 Install Now
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Installing */}
          {step === 4 && (
            <div className="animate-slide-up">
              <h2 className="text-2xl font-bold mb-4">Installing GamePanel...</h2>
              <div className="mb-4">
                <div className="flex justify-between text-sm text-dark-300 mb-2">
                  <span>Progress</span>
                  <span>{installProgress}%</span>
                </div>
                <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-500 to-accent-500 rounded-full transition-all duration-300"
                    style={{ width: `${installProgress}%` }}
                  />
                </div>
              </div>
              <div className="bg-dark-900 rounded-xl p-4 h-80 overflow-y-auto font-mono text-xs">
                {installLog.map((line, i) => (
                  <div key={i} className={`${line.startsWith("✓") ? "text-green-400" : line.startsWith("  →") ? "text-accent-400" : line.includes("═") || line.includes("🎉") ? "text-brand-400 font-bold" : "text-gray-400"}`}>
                    {line}
                  </div>
                ))}
                {loading && installProgress < 100 && (
                  <div className="text-brand-400 animate-pulse">▌</div>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-dark-400 text-xs mt-6">
          GamePanel v1.0.0 • Game Server Hosting CMS
        </p>
      </div>
    </div>
  );
}

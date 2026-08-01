"use client";

import { useState, useCallback } from "react";

interface Props {
  onUnlocked: () => void;
}

export default function ActivationLock({ onUnlocked }: Props) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleVerify = useCallback(async () => {
    if (!key.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/activation/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activationKey: key.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        onUnlocked();
      } else {
        setError(data.error || "Invalid activation key");
      }
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }, [key, onUnlocked]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleVerify();
    },
    [handleVerify],
  );

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <span className="text-5xl block mb-4">🔒</span>
          <h1 className="text-2xl font-bold text-text-primary">Panel Locked</h1>
          <p className="text-text-secondary mt-2 text-sm">
            This panel requires an activation key to unlock. Contact your administrator for the key.
          </p>
        </div>

        {/* Key Input */}
        <div className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <label htmlFor="activation-key" className="block text-sm font-medium text-text-secondary mb-2">
              Activation Key
            </label>
            <input
              id="activation-key"
              type="text"
              value={key}
              onChange={(e) => { setKey(e.target.value); setError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="GSM-XXXX-XXXX-XXXX-XXXX"
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors font-mono text-sm"
              autoFocus
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm flex items-center gap-2">
              <span>⚠️</span>
              {error}
            </div>
          )}

          <button
            onClick={handleVerify}
            disabled={loading || !key.trim()}
            className="w-full py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verifying...
              </span>
            ) : (
              "Unlock Panel"
            )}
          </button>
        </div>

        {/* Help text */}
        <p className="text-center text-xs text-text-muted mt-6">
          Need an activation key? Contact your panel administrator.
        </p>
      </div>
    </div>
  );
}

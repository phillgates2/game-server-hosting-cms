"use client";

import { useState } from "react";

export default function TrackOrderPage() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ status: string; key: string | null; product: string | null; maxActivations: number | null; durationDays: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    if (!orderId.trim() || !email.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/shop/orders/${encodeURIComponent(orderId.trim())}?email=${encodeURIComponent(email.trim())}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "No order matches that ID and email.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const STATUS: Record<string, [string, string]> = {
    pending: ["⏳ Pending", "#eab308"],
    paid: ["💳 Paid — issuing…", "#38bdf8"],
    fulfilled: ["✅ Delivered", "#22c55e"],
    cancelled: ["❌ Cancelled", "#ef4444"],
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0b0f17", color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 560, background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>📦 Track your order</h1>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 22 }}>Enter your order number and the email you purchased with.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Order # (e.g. 42)" style={{ flex: 1, minWidth: 120, background: "#0b0f17", border: "1px solid #1f2937", borderRadius: 10, padding: "12px 14px", color: "#e2e8f0", fontSize: 14, outline: "none" }} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" style={{ flex: 2, minWidth: 200, background: "#0b0f17", border: "1px solid #1f2937", borderRadius: 10, padding: "12px 14px", color: "#e2e8f0", fontSize: 14, outline: "none" }} />
          <button onClick={() => void check()} disabled={busy} style={{ background: "#6366f1", color: "white", border: "none", borderRadius: 10, padding: "12px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{busy ? "…" : "Track"}</button>
        </div>

        {error && <p style={{ marginTop: 18, color: "#ef4444", fontSize: 14 }}>{error}</p>}

        {result && (
          <div style={{ marginTop: 22, border: "1px solid #1f2937", borderRadius: 12, padding: 18 }}>
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: (STATUS[result.status] ?? ["", "#e2e8f0"])[1] }}>
              {(STATUS[result.status] ?? [result.status, "#e2e8f0"])[0]} · {result.product ?? "License"}
            </p>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "#94a3b8" }}>
              {result.maxActivations} activation{result.maxActivations === 1 ? "" : "s"} · {result.durationDays ? `valid ${result.durationDays} days` : "never expires"}
            </p>
            {result.status === "pending" && <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>Waiting for payment approval — your key is issued automatically once it clears.</p>}
            {result.status === "fulfilled" && result.key && (
              <>
                <p style={{ margin: "0 0 6px", fontSize: 12, color: "#94a3b8" }}>Your license key:</p>
                <code style={{ display: "block", background: "#0b0f17", border: "1px solid #1f2937", borderRadius: 8, padding: "10px 12px", fontSize: 13, wordBreak: "break-all" }}>{result.key}</code>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

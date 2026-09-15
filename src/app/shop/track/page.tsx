"use client";

import { useState } from "react";
import Link from "next/link";

export default function TrackOrderPage() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ status: string; key: string | null; product: string | null; maxActivations: number | null; durationDays: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
    refunded: ["↩️ Refunded", "#94a3b8"],
  };

  return (
    <main className="min-h-screen bg-[#0b0f17] text-[#e2e8f0] flex items-center justify-center p-4">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex gap-2">
          <Link href="/shop" className="px-3 py-1.5 rounded-lg bg-[#111827] border border-[#1f2937] text-sm hover:border-[#6366f1]/50 transition-colors">← Shop</Link>
          <Link href="/" className="px-3 py-1.5 rounded-lg bg-[#111827] border border-[#1f2937] text-sm hover:border-[#6366f1]/50 transition-colors">Home</Link>
        </div>
        <div className="rounded-2xl border border-[#1f2937] bg-[#111827] p-6 sm:p-8 space-y-5">
          <div>
            <h1 className="text-xl font-bold">📦 Track your order</h1>
            <p className="text-sm text-[#94a3b8] mt-1">Enter your order number and the email you purchased with.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Order # (e.g. 42)" className="flex-1 min-w-[120px] rounded-xl border border-[#1f2937] bg-[#0b0f17] px-4 py-2.5 text-sm text-white placeholder:text-[#64748b] focus:outline-none focus:ring-2 focus:ring-[#6366f1]" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" className="flex-[2] min-w-[200px] rounded-xl border border-[#1f2937] bg-[#0b0f17] px-4 py-2.5 text-sm text-white placeholder:text-[#64748b] focus:outline-none focus:ring-2 focus:ring-[#6366f1]" />
            <button onClick={() => void check()} disabled={busy} className="px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">{busy ? "…" : "Track"}</button>
          </div>

          {error && <div className="rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#ef4444]">{error}</div>}

          {result && (
            <div className="rounded-xl border border-[#1f2937] bg-[#0b0f17] p-5 space-y-3">
              <p className="text-sm font-bold" style={{ color: (STATUS[result.status] ?? ["", "#e2e8f0"])[1] }}>
                {(STATUS[result.status] ?? [result.status, "#e2e8f0"])[0]} · {result.product ?? "License"}
              </p>
              <p className="text-xs text-[#94a3b8]">
                {result.maxActivations} activation{result.maxActivations === 1 ? "" : "s"} · {result.durationDays ? `valid ${result.durationDays} days` : "never expires"}
              </p>
              {result.status === "pending" && <p className="text-sm text-[#94a3b8]">Waiting for payment approval — your key is issued automatically once it clears.</p>}
              {result.status === "fulfilled" && result.key && (
                <>
                  <p className="text-xs text-[#94a3b8]">Your license key:</p>
                  <div className="flex gap-2">
                    <code className="flex-1 block rounded-xl bg-[#111827] border border-[#1f2937] px-4 py-3 text-sm font-mono break-all text-white">{result.key}</code>
                    <button onClick={async () => { try { await navigator.clipboard.writeText(result.key!); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} }} className="px-4 py-2 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl text-sm font-semibold transition-colors">{copied ? "Copied!" : "Copy"}</button>
                  </div>
                  <Link href={`/shop/order/${orderId}?email=${encodeURIComponent(email)}`} className="inline-block mt-2 text-xs text-[#818cf8] hover:underline">Open detailed order page →</Link>
                </>
              )}
            </div>
          )}
        </div>
        <p className="text-center text-xs text-[#64748b]">Need help? <Link href="/shop" className="text-[#818cf8] hover:underline">Back to shop</Link></p>
      </div>
    </main>
  );
}

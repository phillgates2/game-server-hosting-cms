"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

interface OrderResult {
  orderId: number;
  status: string;
  product: string | null;
  productType: string;
  kind: string;
  imageUrl: string | null;
  createdAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  amountCents: number;
  currency: string;
  quantity: number;
  customerName: string | null;
  key: string | null;
  maxActivations: number | null;
  durationDays: number | null;
}

export default function OrderPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const emailFromUrl = searchParams.get("email") || "";
  const paid = searchParams.get("paid") === "1";
  const cart = searchParams.get("cart") || "";

  const [email, setEmail] = useState(emailFromUrl);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function fetchOrder(e?: string) {
    const em = (e ?? email).trim();
    if (!id || !em) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/shop/orders/${encodeURIComponent(id)}?email=${encodeURIComponent(em)}`);
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

  useEffect(() => {
    if (emailFromUrl && id) {
      const t = setTimeout(() => void fetchOrder(emailFromUrl), 100);
      return () => clearTimeout(t);
    }
  }, [id, emailFromUrl]);

  const STATUS: Record<string, [string, string, string]> = {
    pending: ["⏳ Pending", "#eab308", "Waiting for payment approval — your item is issued automatically once it clears."],
    paid: ["💳 Paid — issuing…", "#38bdf8", "Payment confirmed — your order is being processed now."],
    fulfilled: ["✅ Delivered", "#22c55e", "Your order is complete!"],
    cancelled: ["❌ Cancelled", "#ef4444", "This order was cancelled."],
    refunded: ["↩️ Refunded", "#94a3b8", "This order was refunded."],
  };

  return (
    <main className="min-h-screen bg-[#0b0f17] text-[#e2e8f0] flex flex-col">
      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-6 flex-1">
        <div className="flex items-center gap-3">
          <Link href="/shop" className="px-3 py-1.5 rounded-lg bg-[#111827] border border-[#1f2937] text-sm hover:border-[#6366f1]/50 transition-colors">← Shop</Link>
          <Link href="/" className="px-3 py-1.5 rounded-lg bg-[#111827] border border-[#1f2937] text-sm hover:border-[#6366f1]/50 transition-colors">Home</Link>
        </div>

        <div className="rounded-2xl border border-[#1f2937] bg-[#111827] p-6 sm:p-8 space-y-5">
          <div>
            <h1 className="text-2xl font-bold">📦 Order #{id}</h1>
            <p className="text-sm text-[#94a3b8] mt-1">Track your purchase and retrieve your key.</p>
            {paid && <div className="mt-3 rounded-xl bg-[#22c55e]/10 border border-[#22c55e]/20 px-4 py-3 text-sm text-[#22c55e]">🎉 Payment received! Your order should be ready below — refresh if needed.</div>}
            {cart && <div className="mt-3 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 px-4 py-3 text-sm text-[#818cf8]">This was part of a multi-item cart: orders #{cart}. Each order has its own tracking link with the same email.</div>}
          </div>

          <div className="flex gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" className="flex-1 rounded-xl border border-[#1f2937] bg-[#0b0f17] px-4 py-2.5 text-sm text-white placeholder:text-[#64748b] focus:outline-none focus:ring-2 focus:ring-[#6366f1]" />
            <button onClick={() => void fetchOrder()} disabled={busy || !email.trim()} className="px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">{busy ? "…" : "View"}</button>
          </div>

          {error && <div className="rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#ef4444]">{error}</div>}

          {result && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#1f2937] bg-[#0b0f17] p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg font-bold" style={{ color: (STATUS[result.status] ?? ["", "#e2e8f0"])[1] }}>{(STATUS[result.status] ?? [result.status, "#e2e8f0"])[0]}</span>
                  <span className="text-sm text-[#94a3b8]">· {result.product ?? "Item"} {result.quantity > 1 ? `x${result.quantity}` : ""}</span>
                  <span className="text-xs text-[#64748b]">· Ordered {new Date(result.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-[#94a3b8] mt-2">{(STATUS[result.status] ?? [result.status, "#e2e8f0", ""])[2]}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="px-2.5 py-1 bg-[#111827] border border-[#1f2937] rounded-full text-[#94a3b8]">{result.productType}</span>
                  {result.maxActivations && <span className="px-2.5 py-1 bg-[#111827] border border-[#1f2937] rounded-full text-[#94a3b8]">{result.maxActivations} activation{result.maxActivations === 1 ? "" : "s"}</span>}
                  <span className="px-2.5 py-1 bg-[#111827] border border-[#1f2937] rounded-full text-[#94a3b8]">{result.durationDays ? `valid ${result.durationDays} days` : "no expiry"}</span>
                  {result.paidAt && <span className="px-2.5 py-1 bg-[#111827] border border-[#1f2937] rounded-full text-[#94a3b8]">Paid {new Date(result.paidAt).toLocaleDateString()}</span>}
                  {result.fulfilledAt && <span className="px-2.5 py-1 bg-[#111827] border border-[#1f2937] rounded-full text-[#94a3b8]">Delivered {new Date(result.fulfilledAt).toLocaleDateString()}</span>}
                  <span className="px-2.5 py-1 bg-[#111827] border border-[#1f2937] rounded-full text-[#94a3b8]">{(result.amountCents/100).toFixed(2)} {result.currency.toUpperCase()}</span>
                </div>
              </div>

              {result.status === "fulfilled" && result.key && (
                <div className="rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/10 p-5 space-y-3">
                  <h3 className="font-semibold text-[#22c55e]">Your license key:</h3>
                  <div className="flex gap-2">
                    <code className="flex-1 block rounded-xl bg-[#0b0f17] border border-[#1f2937] px-4 py-3 text-sm font-mono break-all text-white">{result.key}</code>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(result.key!);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch {}
                      }}
                      className="px-4 py-2 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl text-sm font-semibold transition-colors"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-[#94a3b8]">Keep this key safe — it&apos;s shown only here and in your email. Install with: <code className="px-1.5 py-0.5 bg-[#0b0f17] rounded border border-[#1f2937] text-[11px]">bash install.sh --license-key YOUR_KEY</code></p>
                  <div className="flex gap-2 pt-1">
                    <a href="/license" className="px-3 py-1.5 bg-[#111827] border border-[#1f2937] rounded-lg text-xs hover:border-[#6366f1]/30 transition-colors">Check key →</a>
                    <a href="/shop/track" className="px-3 py-1.5 bg-[#111827] border border-[#1f2937] rounded-lg text-xs hover:border-[#6366f1]/30 transition-colors">Track another →</a>
                  </div>
                </div>
              )}

              {result.status === "fulfilled" && !result.key && (
                <div className="rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/10 p-5 space-y-2">
                  <h3 className="font-semibold text-[#22c55e]">✅ Order fulfilled</h3>
                  <p className="text-sm text-[#94a3b8]">
                    {result.productType === "physical" || result.productType === "merch"
                      ? "Your physical item will be shipped — the operator will contact you if needed."
                      : result.productType === "digital"
                      ? "Your digital purchase is ready — check your email or contact support for download instructions."
                      : result.productType === "service"
                      ? "Your service order has been confirmed — the team will be in touch shortly."
                      : "Your order has been completed."}
                  </p>
                  <p className="text-xs text-[#64748b]">Total: {(result.amountCents/100).toFixed(2)} {result.currency.toUpperCase()} · Qty {result.quantity}</p>
                </div>
              )}

              {result.status === "pending" && (
                <div className="rounded-xl border border-[#eab308]/20 bg-[#eab308]/10 p-4">
                  <p className="text-sm text-[#eab308] font-medium">⏳ Awaiting approval</p>
                  <p className="text-xs text-[#94a3b8] mt-1">If you paid via bank transfer or manual method, the operator will approve it shortly. You&apos;ll get an email{result.key ? " with your key" : ""}. If you paid by card and see this for more than 5 minutes, contact support with order #{result.orderId}.</p>
                </div>
              )}
            </div>
          )}

          {!result && !error && !busy && (
            <div className="text-center py-8 rounded-xl bg-[#0b0f17] border border-[#1f2937]">
              <p className="text-sm text-[#64748b]">Enter your email to view this order.</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#1f2937] bg-[#111827] p-4 text-center">
          <p className="text-xs text-[#64748b]">Need help? <Link href="/shop/track" className="text-[#818cf8] hover:underline">Track another order</Link> · <Link href="/shop" className="text-[#818cf8] hover:underline">Back to shop</Link> · <Link href="/" className="text-[#818cf8] hover:underline">Home</Link></p>
        </div>
      </div>
    </main>
  );
}

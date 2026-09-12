"use client";

import { useEffect, useState } from "react";

interface Product {
  id: number;
  name: string;
  description: string | null;
  priceLabel: string;
  priceCents: number;
  maxActivations: number;
  durationDays: number | null;
  kind: string;
  billingInterval: string | null;
}

export default function ShopPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [buying, setBuying] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string; orderId?: number } | null>(null);
  const [coupon, setCoupon] = useState("");
  const [couponInfo, setCouponInfo] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/shop/products");
        const data = await res.json().catch(() => null);
        if (res.ok) {
          setProducts(data?.products ?? []);
          setStripeEnabled(data?.stripeEnabled === true);
        }
      } catch { /* empty shop stays empty */ }
      finally { setLoaded(true); }
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  async function checkCoupon(priceCents: number) {
    if (!coupon.trim()) { setCouponInfo(null); return; }
    try {
      const res = await fetch(`/api/shop/coupons/check?code=${encodeURIComponent(coupon.trim())}&priceCents=${priceCents}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setCouponInfo({ ok: true, text: `✓ ${data.code} applied — you save ${(data.savingsCents / 100).toFixed(2)}!` });
      } else {
        setCouponInfo({ ok: false, text: data?.error || "That coupon is not valid." });
      }
    } catch {
      setCouponInfo({ ok: false, text: "Could not check the coupon." });
    }
  }

  async function buy(productId: number) {
    if (buying !== null) return;
    if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setMessage({ kind: "err", text: "Enter a valid email first — your key is delivered to it." });
      return;
    }
    setBuying(productId);
    setMessage(null);
    try {
      const res = await fetch("/api/shop/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, email: email.trim(), provider: stripeEnabled ? "stripe" : "manual", couponCode: coupon.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ kind: "err", text: data?.error || "Could not place the order." });
        return;
      }
      if (data?.redirect) {
        setMessage({ kind: "ok", text: "Redirecting to secure payment…", orderId: data.orderId });
        window.location.href = data.redirect;
        return;
      }
      setMessage({
        kind: "ok",
        text: data?.message || "Order placed.",
        orderId: data?.orderId,
      });
    } catch {
      setMessage({ kind: "err", text: "Network error — please try again." });
    } finally {
      setBuying(null);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#0b0f17", color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: "40px 20px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>🛒 License Store</h1>
        <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
          Buy a license key for GameServer Manager. Keys are issued automatically after payment and delivered to your email — you can also view them any time on your order page.
        </p>

        <div style={{ marginBottom: 24, maxWidth: 420 }}>
          <label htmlFor="shop-email" style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Your email (where the key goes)</label>
          <input
            id="shop-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ width: "100%", boxSizing: "border-box", background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "12px 14px", color: "#e2e8f0", fontSize: 14, outline: "none" }}
          />
        </div>

        <div style={{ marginBottom: 24, maxWidth: 420 }}>
          <label htmlFor="shop-coupon" style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Coupon code (optional)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="shop-coupon"
              value={coupon}
              onChange={(e) => { setCoupon(e.target.value); setCouponInfo(null); }}
              placeholder="SUMMER25"
              style={{ flex: 1, background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "12px 14px", color: "#e2e8f0", fontSize: 14, outline: "none", textTransform: "uppercase" }}
            />
            <button
              onClick={() => void checkCoupon(products[0]?.priceCents ?? 0)}
              style={{ background: "#374151", color: "white", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >Check</button>
          </div>
          {couponInfo && <p style={{ margin: "8px 0 0", fontSize: 13, color: couponInfo.ok ? "#22c55e" : "#ef4444" }}>{couponInfo.text}</p>}
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "#64748b" }}>Applied automatically at checkout when valid for the product.</p>
        </div>

        {!loaded ? (
          <p style={{ color: "#94a3b8" }}>Loading the store…</p>
        ) : products.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>The store has no products yet — check back soon.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            {products.map((p) => (
              <div key={p.id} style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{p.name}</h3>
                <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, flex: 1, lineHeight: 1.5 }}>{p.description || "A license key for GameServer Manager."}</p>
                <div style={{ fontSize: 12, color: "#cbd5e1" }}>
                  <div>🖥️ {p.maxActivations} activation{p.maxActivations === 1 ? "" : "s"}</div>
                  <div>{p.durationDays ? `⏳ valid ${p.durationDays} days` : "♾️ never expires"}</div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>
                  {p.priceLabel}
                  {p.kind === "subscription" && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}> / {p.billingInterval === "year" ? "year" : "month"}</span>
                  )}
                </div>
                {p.kind === "subscription" && (
                  <div style={{ fontSize: 11, color: "#818cf8" }}>🔁 renews automatically · cancel anytime</div>
                )}
                <button
                  onClick={() => void buy(p.id)}
                  disabled={buying !== null}
                  style={{ background: buying === p.id ? "#374151" : "#6366f1", color: "white", border: "none", borderRadius: 10, padding: "11px 14px", fontSize: 14, fontWeight: 600, cursor: buying !== null ? "default" : "pointer", opacity: buying !== null && buying !== p.id ? 0.5 : 1 }}
                >
                  {buying === p.id ? "Working…" : stripeEnabled ? "Buy with card" : "Order now"}
                </button>
              </div>
            ))}
          </div>
        )}

        {message && (
          <div style={{ marginTop: 24, borderRadius: 12, padding: "14px 16px", fontSize: 14, border: `1px solid ${message.kind === "ok" ? "#22c55e55" : "#ef444455"}`, background: message.kind === "ok" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)" }}>
            <p style={{ margin: 0, color: message.kind === "ok" ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{message.text}</p>
            {message.orderId && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
                Track it here: <a href={`/shop/order/${message.orderId}?email=${encodeURIComponent(email.trim())}`} style={{ color: "#818cf8" }}>/shop/order/{message.orderId}</a>
              </p>
            )}
          </div>
        )}

        <p style={{ marginTop: 32, color: "#64748b", fontSize: 12 }}>
          Already bought? <a href="/shop/track" style={{ color: "#818cf8" }}>Track your order</a> · Need help? <a href="/license" style={{ color: "#818cf8" }}>Check a key</a>
        </p>
      </div>
    </main>
  );
}

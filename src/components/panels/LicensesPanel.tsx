"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";

interface LicenseKeyInfo {
  id: number;
  prefix: string;
  label: string | null;
  maxActivations: number;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
  activations: number;
}

interface AnalyticsSummary {
  totalKeys: number;
  revokedKeys: number;
  unusedKeys: number;
  activeKeys: number;
  silentKeys: number;
  darkKeys: number;
  totalActivations: number;
  activeActivations: number;
}

interface ActivationInfo {
  id: number;
  hostname: string | null;
  panelUrl: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export default function LicensesPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [keys, setKeys] = useState<LicenseKeyInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [maxAct, setMaxAct] = useState(1);
  const [expires, setExpires] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [openActivations, setOpenActivations] = useState<number | null>(null);
  const [activations, setActivations] = useState<ActivationInfo[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsLine, setAnalyticsLine] = useState<string | null>(null);
  const [keyHealth, setKeyHealth] = useState<Record<number, string>>({});
  const [signingKey, setSigningKey] = useState<{ configured: boolean; publicKey: string | null } | null>(null);
  const [offlineResult, setOfflineResult] = useState<{ token: string; publicKey: string; expiresAt: string } | null>(null);
  const [tokenDays, setTokenDays] = useState(90);
  const [products, setProducts] = useState<Array<{ id: number; name: string; priceCents: number; currency: string; maxActivations: number; durationDays: number | null; active: boolean; description: string | null }>>([]);
  const [orders, setOrders] = useState<Array<{ id: number; email: string; provider: string; status: string; amountLabel: string; productName: string | null; createdAt: string; fulfilledAt: string | null }>>([]);
  const [shopErr, setShopErr] = useState<string | null>(null);
  const [pName, setPName] = useState("");
  const [pPrice, setPPrice] = useState("9.00");
  const [pAct, setPAct] = useState(1);
  const [pDays, setPDays] = useState("");
  const [pKind, setPKind] = useState<"onetime" | "subscription">("onetime");
  const [pInterval, setPInterval] = useState<"month" | "year">("month");
  const [coupons, setCoupons] = useState<Array<{ id: number; code: string; kind: string; value: number; maxUses: number | null; usedCount: number; expiresAt: string | null; active: boolean; productId: number | null; productName: string | null }>>([]);
  const [cCode, setCCode] = useState("");
  const [cKind, setCKind] = useState<"percent" | "fixed">("percent");
  const [cValue, setCValue] = useState("10");
  const [cMax, setCMax] = useState("");
  const [cProduct, setCProduct] = useState("");
  const [resellers, setResellers] = useState<Array<{ id: number; label: string; email: string | null; tokenPrefix: string; commissionPct: number; active: boolean; orderCount: number; salesCents: number; commissionCents: number; lastUsedAt: string | null }>>([]);
  const [rLabel, setRLabel] = useState("");
  const [rPct, setRPct] = useState(10);
  const [rToken, setRToken] = useState<{ token: string; label: string } | null>(null);

  async function loadShop() {
    setShopErr(null);
    try {
      const res = await fetch("/api/shop/admin/products");
      const data = await res.json().catch(() => null);
      if (res.ok) setProducts(data?.products ?? []);
      else setShopErr(data?.error || "Shop admin requires the shop.view permission.");
    } catch { setShopErr("Could not load shop products."); }
    try {
      const res = await fetch("/api/shop/admin/orders");
      const data = await res.json().catch(() => null);
      if (res.ok) setOrders(data?.orders ?? []);
    } catch { /* orders optional */ }
  }

  async function loadResellers() {
    try {
      const res = await fetch("/api/shop/admin/resellers");
      const data = await res.json().catch(() => null);
      if (res.ok) setResellers(data?.resellers ?? []);
    } catch { /* optional */ }
  }

  async function createReseller() {
    if (busy || !rLabel.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/shop/admin/resellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: rLabel.trim(), commissionPct: rPct }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.token) {
        setRToken({ token: data.token, label: rLabel.trim() });
        setRLabel("");
        void loadResellers();
      } else toast.error("Reseller", data?.error || "Could not create the reseller");
    } finally { setBusy(false); }
  }

  async function toggleReseller(id: number, active: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/shop/admin/resellers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active: !active }) });
      void loadResellers();
    } finally { setBusy(false); }
  }

  async function loadCoupons() {
    try {
      const res = await fetch("/api/shop/admin/coupons");
      const data = await res.json().catch(() => null);
      if (res.ok) setCoupons(data?.coupons ?? []);
    } catch { /* optional */ }
  }

  async function createCoupon() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/shop/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cCode.trim(), kind: cKind, value: Number(cValue), maxUses: cMax || null, productId: cProduct || null }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Coupon created", `${cCode.trim().toUpperCase()} is live.`); setCCode(""); setCMax(""); void loadCoupons(); }
      else toast.error("Coupon", data?.error || "Could not create the coupon");
    } finally { setBusy(false); }
  }

  async function toggleCoupon(id: number, active: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/shop/admin/coupons", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active: !active }) });
      void loadCoupons();
    } finally { setBusy(false); }
  }

  async function createProduct() {
    if (busy) return;
    const cents = Math.round(Number(pPrice) * 100);
    if (!pName.trim() || !Number.isFinite(cents) || cents < 0) {
      toast.error("Shop", "Give the product a name and a valid price.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/shop/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pName.trim(), priceCents: cents, maxActivations: pAct, durationDays: pDays ? Number(pDays) : null, kind: pKind, billingInterval: pKind === "subscription" ? pInterval : null }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Shop", `"${pName.trim()}" is now on sale.`); setPName(""); setPDays(""); void loadShop(); }
      else toast.error("Shop", data?.error || "Could not create the product");
    } finally { setBusy(false); }
  }

  async function toggleProduct(id: number, active: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/shop/admin/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !active }),
      });
      void loadShop();
    } finally { setBusy(false); }
  }

  async function refundOrder(id: number, email: string, status: string) {
    const isCancel = status === "pending";
    const ok = await confirm({
      title: isCancel ? "Cancel order" : "Refund order",
      message: isCancel
        ? `Cancel pending order #${id} (${email})? No money has moved; the order is simply voided.`
        : `Refund order #${id} (${email})? The license key is REVOKED immediately and the customer loses access. Stripe payments are refunded automatically when configured.`,
      confirmLabel: isCancel ? "Cancel order" : "Refund & revoke key",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shop/admin/orders/${id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: isCancel ? "cancel" : "refund" }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(isCancel ? "Order cancelled" : "Order refunded",
          data?.stripe ? `${data.stripe.detail}` : (isCancel ? "The order was voided." : "Key revoked."));
        void loadShop(); void load();
      } else toast.error("Refund failed", data?.error || "Could not process the refund");
    } finally { setBusy(false); }
  }

  async function approveOrder(id: number, email: string) {
    const ok = await confirm({
      title: "Approve payment",
      message: `Confirm you received payment for order #${id} (${email})? The license key is issued and emailed automatically.`,
      confirmLabel: "Approve & issue key",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shop/admin/orders/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Order approved", `Key issued for order #${id}.`); void loadShop(); void load(); }
      else toast.error("Approval failed", data?.error || "Could not approve the order");
    } finally { setBusy(false); }
  }

  async function loadSigningKeyState() {
    try {
      const res = await fetch("/api/license/signing-key");
      const data = await res.json().catch(() => null);
      if (res.ok) setSigningKey({ configured: data?.configured === true, publicKey: data?.publicKey ?? null });
    } catch { /* optional */ }
  }

  async function generateSigningKey() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/license/signing-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Signing key ready", "You can now issue offline tokens."); void loadSigningKeyState(); }
      else toast.error("Signing key", data?.error || "Could not generate the key");
    } finally { setBusy(false); }
  }

  async function issueOfflineToken(keyId: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/license/keys/${keyId}/offline-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: tokenDays }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.token) setOfflineResult({ token: data.token, publicKey: data.publicKey, expiresAt: data.expiresAt });
      else toast.error("Offline token", data?.error || "Could not issue the token");
    } finally { setBusy(false); }
  }

  async function transferActivation(id: number, hostname: string | null) {
    const ok = await confirm({
      title: "Transfer to new hardware",
      message: `Free the activation for "${hostname ?? "unknown host"}"? The customer can then install on a new machine with the same key. Their old panel will fail its next heartbeat.`,
      confirmLabel: "Transfer",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/license/activations/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Transferred", "The activation slot is free — the customer can install on their new hardware."); setOpenActivations(null); void load(); }
      else toast.error("Transfer failed", data?.error || "Could not free the activation");
    } finally { setBusy(false); }
  }

  async function load() {
    try {
      const res = await fetch("/api/license/keys");
      const data = await res.json().catch(() => null);
      if (res.ok) setKeys(data?.keys ?? []);
      else toast.error("Licenses", data?.error || "Could not load license keys");
    } catch { /* panel keeps working */ }
    finally { setLoaded(true); }
    try {
      const res = await fetch("/api/license/analytics");
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setAnalytics(data.summary ?? null);
        setAnalyticsLine(data.line ?? null);
        const health: Record<number, string> = {};
        for (const k of data.keys ?? []) health[k.keyId] = k.health;
        setKeyHealth(health);
      }
    } catch { /* analytics are optional sugar */ }
    void loadSigningKeyState();
    void loadShop();
    void loadCoupons();
    void loadResellers();
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function issueKey() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/license/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || null,
          maxActivations: maxAct,
          expiresAt: expires || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.key) {
        setIssuedKey(data.key);
        setLabel(""); setExpires("");
        void load();
      } else {
        toast.error("Issue failed", data?.error || "Could not issue the key");
      }
    } catch (e) { toast.error("Issue failed", e instanceof Error ? e.message : "Network error"); }
    finally { setBusy(false); }
  }

  async function revokeKey(id: number, prefix: string) {
    const ok = await confirm({
      title: "Revoke license",
      message: `Revoke ${prefix}? Installations using it will fail re-validation immediately. This cannot be undone.`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/license/keys/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Revoked", `${prefix} can no longer be used.`); void load(); }
      else toast.error("Revoke failed", data?.error || "Could not revoke the key");
    } finally { setBusy(false); }
  }

  async function showActivations(id: number) {
    if (openActivations === id) { setOpenActivations(null); return; }
    setOpenActivations(id);
    setActivations([]);
    try {
      const res = await fetch(`/api/license/keys/${id}`);
      const data = await res.json().catch(() => null);
      if (res.ok) setActivations(data?.activations ?? []);
    } catch { /* empty list stays */ }
  }

  async function copyKey(key: string) {
    try { await navigator.clipboard.writeText(key); toast.success("Copied", "License key copied to clipboard."); }
    catch { toast.error("Copy failed", "Select and copy the key manually."); }
  }

  return (
    <div className="space-y-4">
      {/* Issued-once banner */}
      {issuedKey && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-success">✅ License key issued — this is the ONLY time it is shown:</p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-text-primary font-mono">{issuedKey}</code>
            <button onClick={() => void copyKey(issuedKey)} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover">Copy</button>
            <button onClick={() => setIssuedKey(null)} className="text-xs text-text-muted hover:text-text-primary">Dismiss</button>
          </div>
          <p className="text-[11px] text-text-muted">Give this key to your customer — their installer will validate it against this panel. Only the hash is stored here.</p>
        </div>
      )}

      {/* Usage analytics */}
      {analytics && (
        <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold">📈 License usage</h3>
            {analyticsLine && <span className="text-xs text-text-secondary">{analyticsLine}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg bg-success/10 px-3 py-1.5 text-xs text-success">{analytics.activeKeys} active keys</span>
            <span className="rounded-lg bg-warning/10 px-3 py-1.5 text-xs text-warning">{analytics.silentKeys} silent (7-30d)</span>
            <span className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger">{analytics.darkKeys} dark (30d+)</span>
            <span className="rounded-lg bg-bg-secondary px-3 py-1.5 text-xs text-text-muted">{analytics.unusedKeys} unused</span>
            <span className="rounded-lg bg-bg-secondary px-3 py-1.5 text-xs text-text-muted">{analytics.revokedKeys} revoked</span>
            <span className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent">{analytics.activeActivations}/{analytics.totalActivations} installs phoned home</span>
          </div>
        </div>
      )}

      {/* Issue form */}
      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold">🎟️ Issue a license key</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={128} placeholder="Label — e.g. customer name or order #" className="min-w-[220px] flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted" />
          <label className="text-xs text-text-muted flex items-center gap-1">
            Activations
            <input type="number" min={1} max={100} value={maxAct} onChange={(e) => setMaxAct(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-16 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" />
          </label>
          <label className="text-xs text-text-muted flex items-center gap-1">
            Expires
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" />
          </label>
          <button onClick={() => void issueKey()} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">{busy ? "Working…" : "Issue key"}</button>
        </div>
        <p className="text-[10px] text-text-muted">1 activation = 1 installation. Re-validation from the same machine never consumes an extra activation.</p>
      </div>

      {/* Offline token result */}
      {offlineResult && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-accent">📦 Offline token issued (expires {new Date(offlineResult.expiresAt).toLocaleDateString()}) — hand BOTH to the customer:</p>
          <p className="text-[11px] text-text-muted">1) Token:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-bg-card border border-border px-3 py-2 text-xs font-mono text-text-primary">{offlineResult.token}</code>
            <button onClick={() => { void navigator.clipboard.writeText(offlineResult.token).then(() => toast.success("Copied", "Token copied.")); }} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover">Copy</button>
          </div>
          <p className="text-[11px] text-text-muted">2) Public key (verifies the token):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-bg-card border border-border px-3 py-2 text-xs font-mono text-text-primary">{offlineResult.publicKey.replace(/\n/g, " ")}</code>
            <button onClick={() => { void navigator.clipboard.writeText(offlineResult.publicKey).then(() => toast.success("Copied", "Public key copied.")); }} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover">Copy</button>
            <button onClick={() => setOfflineResult(null)} className="text-xs text-text-muted hover:text-text-primary">Dismiss</button>
          </div>
          <p className="text-[10px] text-text-muted">Install with: bash install.sh --license-token &lt;token&gt; --license-pubkey pubkey.pem  — or paste both into the web installer.</p>
        </div>
      )}

      {/* Shop: products + orders */}
      {shopErr ? (
        <p className="text-xs text-text-muted">{shopErr}</p>
      ) : (
        <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold">🛒 Shop — sell license keys</h3>
            <a href="/shop" target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">Open storefront ↗</a>
          </div>

          {/* order book */}
          {orders.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-text-muted">Orders (newest first)</p>
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-1.5">
                    <span className="text-xs font-mono text-text-primary">#{o.id}</span>
                    <span className="text-xs text-text-secondary truncate max-w-[180px]">{o.email}</span>
                    <span className="text-[11px] text-text-muted">{o.productName ?? "?"} · {o.amountLabel}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${o.status === "fulfilled" ? "bg-success/15 text-success" : o.status === "pending" ? "bg-warning/15 text-warning" : o.status === "paid" ? "bg-accent/15 text-accent" : o.status === "refunded" ? "bg-text-muted/20 text-text-muted" : "bg-danger/15 text-danger"}`}>{o.status}</span>
                    <span className="flex-1" />
                    {o.status === "pending" && o.provider === "manual" && (
                      <button onClick={() => void approveOrder(o.id, o.email)} disabled={busy} className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-40">Approve payment</button>
                    )}
                    {o.status === "pending" && (
                      <button onClick={() => void refundOrder(o.id, o.email, o.status)} disabled={busy} className="text-[11px] text-text-muted hover:text-danger disabled:opacity-40">Cancel</button>
                    )}
                    {(o.status === "paid" || o.status === "fulfilled") && (
                      <button onClick={() => void refundOrder(o.id, o.email, o.status)} disabled={busy} className="text-[11px] text-danger/80 hover:text-danger disabled:opacity-40">Refund</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* products */}
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-text-muted">Products</p>
            {products.length === 0 ? (
              <p className="text-xs text-text-muted">No products yet — create one below to open the store.</p>
            ) : (
              <div className="space-y-1">
                {products.map((pr) => (
                  <div key={pr.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-1.5">
                    <span className="text-xs font-medium text-text-primary">{pr.name}</span>
                    <span className="text-[11px] text-text-muted">${(pr.priceCents / 100).toFixed(2)} · {pr.maxActivations} act · {pr.durationDays ? `${pr.durationDays}d` : "∞"}</span>
                    <span className="flex-1" />
                    <button onClick={() => void toggleProduct(pr.id, pr.active)} disabled={busy} className={`text-[11px] ${pr.active ? "text-success" : "text-text-muted"} hover:underline disabled:opacity-40`}>{pr.active ? "On sale ✓" : "Hidden"}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* coupons */}
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-text-muted">Coupons</p>
            {coupons.length === 0 ? (
              <p className="text-xs text-text-muted">No coupons yet.</p>
            ) : (
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {coupons.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-1.5">
                    <code className="text-xs font-mono text-text-primary">{c.code}</code>
                    <span className="text-[11px] text-text-muted">{c.kind === "percent" ? `${c.value}% off` : `$${(c.value / 100).toFixed(2)} off`}{c.productId ? ` · ${c.productName ?? "product"}` : " · all products"} · {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""} used{c.expiresAt ? ` · until ${new Date(c.expiresAt).toLocaleDateString()}` : ""}</span>
                    <span className="flex-1" />
                    <button onClick={() => void toggleCoupon(c.id, c.active)} disabled={busy} className={`text-[11px] ${c.active ? "text-success" : "text-text-muted"} hover:underline disabled:opacity-40`}>{c.active ? "Active ✓" : "Disabled"}</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <input value={cCode} onChange={(e) => setCCode(e.target.value)} placeholder="CODE e.g. SUMMER25" className="w-36 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs font-mono uppercase text-text-primary placeholder:text-text-muted placeholder:normal-case" />
              <select value={cKind} onChange={(e) => setCKind(e.target.value as "percent" | "fixed")} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary">
                <option value="percent">% off</option>
                <option value="fixed">$ off (cents)</option>
              </select>
              <input value={cValue} onChange={(e) => setCValue(e.target.value)} className="w-16 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" title={cKind === "percent" ? "Percent 1-100" : "Cents off"} />
              <input value={cMax} onChange={(e) => setCMax(e.target.value)} placeholder="max uses" className="w-20 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary placeholder:text-text-muted" />
              <select value={cProduct} onChange={(e) => setCProduct(e.target.value)} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary">
                <option value="">All products</option>
                {products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
              </select>
              <button onClick={() => void createCoupon()} disabled={busy || !cCode.trim() || !Number(cValue)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">Add coupon</button>
            </div>
          </div>

          {/* resellers */}
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-text-muted">Resellers</p>
            {rToken && (
              <div className="rounded-lg border border-success/40 bg-success/10 p-3 space-y-1">
                <p className="text-xs font-semibold text-success">Reseller token for “{rToken.label}” — shown only once:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-bg-card border border-border px-2 py-1.5 text-xs font-mono text-text-primary">{rToken.token}</code>
                  <button onClick={() => { void navigator.clipboard.writeText(rToken.token).then(() => toast.success("Copied", "Reseller token copied.")); }} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover">Copy</button>
                  <button onClick={() => setRToken(null)} className="text-xs text-text-muted hover:text-text-primary">Done</button>
                </div>
              </div>
            )}
            {resellers.length === 0 ? (
              <p className="text-xs text-text-muted">No resellers yet. Partners order with their token (X-Reseller-Token header) and earn their commission automatically.</p>
            ) : (
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {resellers.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-1.5">
                    <span className="text-xs font-medium text-text-primary">{r.label}</span>
                    <span className="text-[11px] text-text-muted font-mono">{r.tokenPrefix}… · {r.commissionPct}% · {r.orderCount} orders · ${(r.salesCents / 100).toFixed(2)} sold · ${(r.commissionCents / 100).toFixed(2)} earned{r.lastUsedAt ? ` · last ${new Date(r.lastUsedAt).toLocaleDateString()}` : ""}</span>
                    <span className="flex-1" />
                    <button onClick={() => void toggleReseller(r.id, r.active)} disabled={busy} className={`text-[11px] ${r.active ? "text-success" : "text-text-muted"} hover:underline disabled:opacity-40`}>{r.active ? "Active ✓" : "Disabled"}</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <input value={rLabel} onChange={(e) => setRLabel(e.target.value)} placeholder="Reseller name, e.g. GameShop AU" className="min-w-[180px] flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted" />
              <label className="text-[11px] text-text-muted flex items-center gap-1">
                commission %
                <input type="number" min={0} max={90} value={rPct} onChange={(e) => setRPct(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} className="w-14 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" />
              </label>
              <button onClick={() => void createReseller()} disabled={busy || !rLabel.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">Add reseller</button>
            </div>
          </div>

          {/* create product */}
          <div className="flex items-center gap-2 flex-wrap border-t border-border pt-3">
            <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Product name, e.g. Solo license" className="min-w-[180px] flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted" />
            <label className="text-[11px] text-text-muted flex items-center gap-1">
              $
              <input value={pPrice} onChange={(e) => setPPrice(e.target.value)} className="w-16 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" />
            </label>
            <label className="text-[11px] text-text-muted flex items-center gap-1">
              activations
              <input type="number" min={1} max={100} value={pAct} onChange={(e) => setPAct(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-14 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" />
            </label>
            <label className="text-[11px] text-text-muted flex items-center gap-1">
              days
              <input value={pDays} onChange={(e) => setPDays(e.target.value)} placeholder="∞" className="w-14 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary placeholder:text-text-muted" />
            </label>
            <select value={pKind} onChange={(e) => setPKind(e.target.value as "onetime" | "subscription")} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" title="Subscriptions renew via Stripe">
              <option value="onetime">one-time</option>
              <option value="subscription">subscription</option>
            </select>
            {pKind === "subscription" && (
              <select value={pInterval} onChange={(e) => setPInterval(e.target.value as "month" | "year")} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary">
                <option value="month">per month</option>
                <option value="year">per year</option>
              </select>
            )}
            <button onClick={() => void createProduct()} disabled={busy || !pName.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">{busy ? "Working…" : "Add product"}</button>
          </div>
          <p className="text-[10px] text-text-muted">Buyers pay in the storefront (/shop). Stripe checkout activates automatically when STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are set; otherwise orders wait here for manual approval.</p>
        </div>
      )}

      {/* Signing key for offline tokens */}
      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold">🔏 Offline tokens (air-gapped installs)</h3>
          {signingKey && !signingKey.configured && (
            <button onClick={() => void generateSigningKey()} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">{busy ? "Working…" : "Generate signing key"}</button>
          )}
        </div>
        {signingKey === null ? (
          <p className="text-xs text-text-muted">Loading…</p>
        ) : signingKey.configured ? (
          <>
            <p className="text-xs text-text-secondary">Signing key ready — use “Offline token” on any key below. Tokens are Ed25519-signed and verified locally on the customer box; no network needed.</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted">Token lifetime</label>
              <select value={tokenDays} onChange={(e) => setTokenDays(Number(e.target.value))} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary">
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>1 year</option>
              </select>
            </div>
          </>
        ) : (
          <p className="text-xs text-text-muted">Generate an Ed25519 signing key to issue pre-signed tokens for air-gapped customers. The private key stays in this panel&apos;s database; only the public half travels.</p>
        )}
      </div>

      {/* Key list */}
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Issued keys</h3>
        {!loaded ? (
          <p className="text-xs text-text-muted">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-text-muted">No license keys yet — issue one above to distribute installations.</p>
        ) : (
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={k.id}>
                <div className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-2">
                  <code className="font-mono text-xs text-text-primary">{k.prefix}</code>
                  <span className="text-xs text-text-secondary truncate max-w-[180px]">{k.label ?? "—"}</span>
                  <button onClick={() => void showActivations(k.id)} className="text-[11px] text-accent hover:underline">{k.activations}/{k.maxActivations} activations</button>
                  {k.expiresAt ? <span className="text-[10px] text-text-muted">expires {new Date(k.expiresAt).toLocaleDateString()}</span> : <span className="text-[10px] text-text-muted">never expires</span>}
                  <span className="flex-1" />
                  {!k.revoked && signingKey?.configured && (
                    <button onClick={() => void issueOfflineToken(k.id)} disabled={busy} className="text-[11px] text-accent hover:underline disabled:opacity-40">Offline token</button>
                  )}
                  {!k.revoked && keyHealth[k.id] && keyHealth[k.id] !== "never" && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${keyHealth[k.id] === "active" ? "bg-success/15 text-success" : keyHealth[k.id] === "silent" ? "bg-warning/15 text-warning" : "bg-danger/15 text-danger"}`}
                      title={keyHealth[k.id] === "active" ? "Phoned home within 7 days" : keyHealth[k.id] === "silent" ? "Last seen 7-30 days ago" : "Not seen in 30+ days"}
                    >{keyHealth[k.id]}</span>
                  )}
                  {k.revoked ? (
                    <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">revoked</span>
                  ) : (
                    <button onClick={() => void revokeKey(k.id, k.prefix)} disabled={busy} className="text-[11px] text-text-muted hover:text-danger disabled:opacity-40">Revoke</button>
                  )}
                </div>
                {openActivations === k.id && (
                  <div className="mt-1 ml-4 space-y-1">
                    {activations.length === 0 ? (
                      <p className="text-[11px] text-text-muted">No activations yet.</p>
                    ) : activations.map((a) => (
                      <div key={a.id} className="flex items-center gap-2">
                        <p className="flex-1 truncate text-[11px] font-mono text-text-secondary">
                          {a.hostname ?? "?"} · {a.panelUrl ?? "?"} · {a.ipAddress ?? "?"} · first {new Date(a.createdAt).toLocaleString()} · seen {new Date(a.lastSeenAt).toLocaleString()}
                        </p>
                        <button
                          onClick={() => void transferActivation(a.id, a.hostname)}
                          disabled={busy}
                          title="Free this activation so the customer can move to new hardware"
                          className="text-[11px] text-accent hover:underline disabled:opacity-40"
                        >Transfer</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

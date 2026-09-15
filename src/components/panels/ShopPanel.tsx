"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";

interface Product {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  maxActivations: number;
  durationDays: number | null;
  active: boolean;
  kind: string;
  billingInterval: string | null;
  imageUrl: string | null;
  category: string;
  productType: string;
  stockQuantity: number | null;
  featured: boolean;
  sku: string | null;
  badge: string | null;
  compareAtPriceCents: number | null;
  allowQuantity: boolean;
  sortOrder: number;
  gameId: number | null;
  createdAt: string;
}

interface Order {
  id: number;
  email: string;
  productId: number;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  productName: string | null;
  createdAt: string;
  fulfilledAt: string | null;
  amountLabel: string;
  quantity?: number;
  customerName?: string | null;
}

interface Coupon {
  id: number;
  code: string;
  kind: string;
  value: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
  productId: number | null;
  productName: string | null;
}

interface Reseller {
  id: number;
  label: string;
  email: string | null;
  tokenPrefix: string;
  commissionPct: number;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  orderCount: number;
  salesCents: number;
  commissionCents: number;
}

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  active: boolean;
}

type Tab = "overview" | "products" | "orders" | "coupons" | "resellers" | "categories" | "payments";

export default function ShopPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("overview");
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Product form
  const [pForm, setPForm] = useState({
    name: "",
    description: "",
    price: "9.99",
    compareAt: "",
    category: "general",
    productType: "license",
    stock: "",
    sku: "",
    badge: "",
    featured: false,
    active: true,
    allowQuantity: true,
    maxActivations: "1",
    durationDays: "",
    kind: "onetime",
    interval: "month",
    imageUrl: "",
    sortOrder: "0",
  });
  const [editingId, setEditingId] = useState<number | null>(null);

  // Coupon form
  const [cCode, setCCode] = useState("");
  const [cKind, setCKind] = useState<"percent" | "fixed">("percent");
  const [cValue, setCValue] = useState("10");
  const [cMax, setCMax] = useState("");
  const [cProduct, setCProduct] = useState("");

  // Reseller form
  const [rLabel, setRLabel] = useState("");
  const [rPct, setRPct] = useState(10);
  const [rToken, setRToken] = useState<{ token: string; label: string } | null>(null);

  // Category form
  const [catName, setCatName] = useState("");
  const [catSlug, setCatSlug] = useState("");
  const [catIcon, setCatIcon] = useState("🛒");

  async function loadAll() {
    setErr(null);
    try {
      const [prodRes, orderRes, couponRes, resellerRes, catRes, analyticsRes] = await Promise.allSettled([
        fetch("/api/shop/admin/products"),
        fetch("/api/shop/admin/orders"),
        fetch("/api/shop/admin/coupons"),
        fetch("/api/shop/admin/resellers"),
        fetch("/api/shop/admin/categories"),
        fetch("/api/shop/admin/analytics"),
      ]);

      if (prodRes.status === "fulfilled" && prodRes.value.ok) {
        const d = await prodRes.value.json();
        setProducts(d.products ?? []);
        setStripeEnabled(d.stripeEnabled === true);
      }
      if (orderRes.status === "fulfilled" && orderRes.value.ok) {
        const d = await orderRes.value.json();
        setOrders(d.orders ?? []);
      }
      if (couponRes.status === "fulfilled" && couponRes.value.ok) {
        const d = await couponRes.value.json();
        setCoupons(d.coupons ?? []);
      }
      if (resellerRes.status === "fulfilled" && resellerRes.value.ok) {
        const d = await resellerRes.value.json();
        setResellers(d.resellers ?? []);
      }
      if (catRes.status === "fulfilled" && catRes.value.ok) {
        const d = await catRes.value.json();
        setCategories(d.categories ?? []);
      }
      if (analyticsRes.status === "fulfilled" && analyticsRes.value.ok) {
        const d = await analyticsRes.value.json();
        setAnalytics(d);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
  }, []);

  async function createOrUpdateProduct() {
    if (busy || !pForm.name.trim()) return;
    const cents = Math.round(Number(pForm.price) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      toast.error("Shop", "Invalid price");
      return;
    }
    setBusy(true);
    try {
      const payload: any = {
        name: pForm.name.trim(),
        description: pForm.description.trim() || null,
        priceCents: cents,
        compareAtPriceCents: pForm.compareAt ? Math.round(Number(pForm.compareAt) * 100) : null,
        category: pForm.category,
        productType: pForm.productType,
        stockQuantity: pForm.stock ? Number(pForm.stock) : null,
        sku: pForm.sku.trim() || null,
        badge: pForm.badge.trim() || null,
        featured: pForm.featured,
        active: pForm.active,
        allowQuantity: pForm.allowQuantity,
        maxActivations: Number(pForm.maxActivations) || 1,
        durationDays: pForm.durationDays ? Number(pForm.durationDays) : null,
        kind: pForm.kind,
        billingInterval: pForm.kind === "subscription" ? pForm.interval : null,
        imageUrl: pForm.imageUrl.trim() || null,
        sortOrder: Number(pForm.sortOrder) || 0,
      };

      let res: Response;
      if (editingId) {
        res = await fetch("/api/shop/admin/products", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
      } else {
        res = await fetch("/api/shop/admin/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(editingId ? "Product updated" : "Product created", `"${pForm.name}" ${editingId ? "updated" : "is now on sale"}.`);
        setPForm({
          name: "",
          description: "",
          price: "9.99",
          compareAt: "",
          category: "general",
          productType: "license",
          stock: "",
          sku: "",
          badge: "",
          featured: false,
          active: true,
          allowQuantity: true,
          maxActivations: "1",
          durationDays: "",
          kind: "onetime",
          interval: "month",
          imageUrl: "",
          sortOrder: "0",
        });
        setEditingId(null);
        void loadAll();
      } else {
        toast.error("Shop", data?.error || "Could not save product");
      }
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: Product) {
    setEditingId(p.id);
    setPForm({
      name: p.name,
      description: p.description || "",
      price: (p.priceCents / 100).toFixed(2),
      compareAt: p.compareAtPriceCents ? (p.compareAtPriceCents / 100).toFixed(2) : "",
      category: p.category || "general",
      productType: p.productType || "license",
      stock: p.stockQuantity !== null ? String(p.stockQuantity) : "",
      sku: p.sku || "",
      badge: p.badge || "",
      featured: p.featured,
      active: p.active,
      allowQuantity: p.allowQuantity,
      maxActivations: String(p.maxActivations),
      durationDays: p.durationDays ? String(p.durationDays) : "",
      kind: p.kind || "onetime",
      interval: (p.billingInterval as any) || "month",
      imageUrl: p.imageUrl || "",
      sortOrder: String(p.sortOrder ?? 0),
    });
    setTab("products");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleProduct(id: number, active: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/shop/admin/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active: !active }) });
      void loadAll();
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct(id: number) {
    const ok = await confirm({ title: "Delete product", message: `Delete product #${id}? If it has orders, it will be disabled instead.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shop/admin/products?id=${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Product", data?.soft ? "Product disabled (has orders)" : "Product deleted");
        void loadAll();
      } else {
        toast.error("Delete failed", data?.error || "Could not delete");
      }
    } finally {
      setBusy(false);
    }
  }

  async function approveOrder(id: number, email: string) {
    const ok = await confirm({ title: "Approve payment", message: `Confirm payment for order #${id} (${email})? Key issued automatically.`, confirmLabel: "Approve & issue" });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shop/admin/orders/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Order approved", `Key issued for #${id}`);
        void loadAll();
      } else toast.error("Approval failed", data?.error || "Could not approve");
    } finally {
      setBusy(false);
    }
  }

  async function refundOrder(id: number, email: string, status: string) {
    const isCancel = status === "pending";
    const ok = await confirm({
      title: isCancel ? "Cancel order" : "Refund order",
      message: isCancel ? `Cancel pending order #${id} (${email})?` : `Refund order #${id} (${email})? Key REVOKED immediately.`,
      confirmLabel: isCancel ? "Cancel order" : "Refund & revoke",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shop/admin/orders/${id}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: isCancel ? "cancel" : "refund" }) });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(isCancel ? "Cancelled" : "Refunded", data?.stripe ? data.stripe.detail : isCancel ? "Voided" : "Revoked");
        void loadAll();
      } else toast.error("Failed", data?.error || "Could not process");
    } finally {
      setBusy(false);
    }
  }

  async function createCoupon() {
    if (busy || !cCode.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/shop/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cCode.trim(), kind: cKind, value: Number(cValue), maxUses: cMax || null, productId: cProduct || null }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Coupon created", `${cCode.toUpperCase()} live`);
        setCCode(""); setCMax("");
        void loadAll();
      } else toast.error("Coupon", data?.error || "Could not create");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCoupon(id: number, active: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/shop/admin/coupons", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active: !active }) });
      void loadAll();
    } finally {
      setBusy(false);
    }
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
        void loadAll();
      } else toast.error("Reseller", data?.error || "Could not create");
    } finally {
      setBusy(false);
    }
  }

  async function toggleReseller(id: number, active: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/shop/admin/resellers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active: !active }) });
      void loadAll();
    } finally {
      setBusy(false);
    }
  }

  async function createCategory() {
    if (busy || !catName.trim()) return;
    setBusy(true);
    try {
      const slug = catSlug.trim() || catName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const res = await fetch("/api/shop/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: catName.trim(), slug, icon: catIcon }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Category", `"${catName}" created`);
        setCatName(""); setCatSlug("");
        void loadAll();
      } else toast.error("Category", data?.error || "Could not create");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">🛒 Shop Management</h2>
          <p className="text-sm text-text-secondary">Sell licenses, game servers, digital goods and more — full storefront & backend.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/shop" target="_blank" className="px-3 py-1.5 bg-bg-card border border-border rounded-lg text-xs hover:border-accent/30 transition-colors">Open storefront ↗</a>
          <button onClick={() => void loadAll()} className="px-3 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs hover:bg-bg-hover">↻ Refresh</button>
        </div>
      </div>

      {err && <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{err}</div>}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-bg-secondary rounded-xl border border-border w-fit">
        {[
          ["overview", "📊 Overview"],
          ["products", `📦 Products (${products.length})`],
          ["orders", `🧾 Orders (${orders.length})`],
          ["coupons", `🎟️ Coupons (${coupons.length})`],
          ["resellers", `🤝 Resellers (${resellers.length})`],
          ["categories", `📂 Categories (${categories.length})`],
          ["payments", "💳 Payments"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k as Tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === k ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Payment settings */}
      {tab === "payments" && (
        <div className="space-y-4 max-w-3xl">
          <div className="rounded-xl border border-border bg-bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="font-semibold">Stripe payments</h3><p className="text-xs text-text-muted mt-1">Secure card checkout for one-time purchases and subscriptions.</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${stripeEnabled ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{stripeEnabled ? "Enabled" : "Not configured"}</span>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <p>Set these server environment variables, then restart the application:</p>
              <pre className="overflow-x-auto rounded-lg bg-bg-secondary p-3 text-xs text-text-secondary">STRIPE_SECRET_KEY=sk_live_...{`\n`}STRIPE_WEBHOOK_SECRET=whsec_...</pre>
              <p className="text-xs text-text-muted">In Stripe, add a webhook endpoint:</p>
              <code className="block rounded-lg bg-bg-secondary p-3 text-xs text-accent">{typeof window !== "undefined" ? window.location.origin : "https://your-domain"}/api/shop/stripe-webhook</code>
              <p className="text-xs text-text-muted">Subscribe to <strong>checkout.session.completed</strong> and <strong>checkout.session.expired</strong>. The webhook activates and fulfils paid orders automatically. Without Stripe, orders remain available for manual approval.</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-bg-card p-5 text-sm">
            <h3 className="font-semibold mb-2">Payment flow</h3>
            <ul className="list-disc pl-5 space-y-1 text-text-secondary text-xs"><li>Cards are handled by Stripe; card details never touch this server.</li><li>Use test keys beginning with <code>sk_test_</code> while validating checkout.</li><li>Never paste secret keys into product descriptions or browser code.</li></ul>
          </div>
        </div>
      )}

      {/* Overview */}
      {tab === "overview" && analytics && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="rounded-xl border border-border bg-bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted">Total Revenue</p>
              <p className="text-xl font-bold text-success">${(analytics.summary.totalRevenue / 100).toFixed(2)}</p>
              <p className="text-xs text-text-muted">{analytics.summary.totalOrders} orders total</p>
            </div>
            <div className="rounded-xl border border-border bg-bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted">Pending</p>
              <p className="text-xl font-bold text-warning">{analytics.summary.pendingOrders}</p>
              <p className="text-xs text-text-muted">need approval</p>
            </div>
            <div className="rounded-xl border border-border bg-bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted">Fulfilled</p>
              <p className="text-xl font-bold text-success">{analytics.summary.fulfilledOrders}</p>
              <p className="text-xs text-text-muted">delivered</p>
            </div>
            <div className="rounded-xl border border-border bg-bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted">Products</p>
              <p className="text-xl font-bold text-accent">{products.filter((p) => p.active).length}</p>
              <p className="text-xs text-text-muted">{products.length} total</p>
            </div>
            <div className="rounded-xl border border-border bg-bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted">Refunded</p>
              <p className="text-xl font-bold text-danger">{analytics.summary.refundedOrders}</p>
              <p className="text-xs text-text-muted">cancelled/refunded</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-bg-card p-4">
              <h3 className="font-semibold text-sm mb-3">🏆 Top Products</h3>
              {analytics.topProducts?.length ? (
                <div className="space-y-2">
                  {analytics.topProducts.map((tp: any) => (
                    <div key={tp.productId} className="flex items-center justify-between rounded-lg bg-bg-secondary px-3 py-2">
                      <span className="text-sm font-medium truncate">{tp.productName || `Product #${tp.productId}`}</span>
                      <span className="text-xs text-text-muted">{tp.orderCount} orders · ${(tp.revenue / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-text-muted">No sales yet</p>}
            </div>
            <div className="rounded-xl border border-border bg-bg-card p-4">
              <h3 className="font-semibold text-sm mb-3">📈 Status Breakdown</h3>
              <div className="flex flex-wrap gap-2">
                {analytics.statusCounts?.map((s: any) => (
                  <span key={s.status} className={`px-3 py-1.5 rounded-full text-xs font-medium ${s.status === "fulfilled" ? "bg-success/15 text-success" : s.status === "pending" ? "bg-warning/15 text-warning" : s.status === "paid" ? "bg-accent/15 text-accent" : "bg-bg-secondary text-text-muted"}`}>
                    {s.status}: {s.count}
                  </span>
                ))}
              </div>
              <div className="mt-4 space-y-1">
                <p className="text-[11px] uppercase tracking-wider text-text-muted">Recent Orders</p>
                {orders.slice(0, 5).map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-xs rounded bg-bg-secondary px-2 py-1">
                    <span className="font-mono">#{o.id}</span>
                    <span className="truncate max-w-[120px]">{o.email}</span>
                    <span className={o.status === "fulfilled" ? "text-success" : o.status === "pending" ? "text-warning" : "text-text-muted"}>{o.status}</span>
                    <span>{o.amountLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Products */}
      {tab === "products" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-bg-card p-4 space-y-4">
            <h3 className="font-semibold text-sm">{editingId ? `✏️ Edit Product #${editingId}` : "➕ Add New Product"}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2">
                <label className="block text-[11px] text-text-muted mb-1">Name *</label>
                <input value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} placeholder="e.g. Premium License, 10 Slot CS2 Server" className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Price * (e.g. 19.99)</label>
                <input value={pForm.price} onChange={(e) => setPForm({ ...pForm, price: e.target.value })} className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-[11px] text-text-muted mb-1">Description</label>
                <textarea value={pForm.description} onChange={(e) => setPForm({ ...pForm, description: e.target.value })} rows={2} placeholder="What does this product include? Features, specs, etc." className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Category</label>
                <select value={pForm.category} onChange={(e) => setPForm({ ...pForm, category: e.target.value })} className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm">
                  <option value="general">General</option>
                  <option value="licenses">Licenses</option>
                  <option value="servers">Game Servers</option>
                  <option value="digital">Digital Goods</option>
                  <option value="services">Services</option>
                  <option value="merch">Merch</option>
                  {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Type</label>
                <select value={pForm.productType} onChange={(e) => setPForm({ ...pForm, productType: e.target.value })} className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm">
                  <option value="license">🔑 License</option>
                  <option value="server">🎮 Game Server</option>
                  <option value="digital">💾 Digital</option>
                  <option value="physical">📦 Physical</option>
                  <option value="service">🛠️ Service</option>
                  <option value="subscription">🔁 Subscription</option>
                  <option value="merch">👕 Merch</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Badge (optional)</label>
                <input value={pForm.badge} onChange={(e) => setPForm({ ...pForm, badge: e.target.value })} placeholder="Popular, New, Sale, etc." className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Compare At Price (sale)</label>
                <input value={pForm.compareAt} onChange={(e) => setPForm({ ...pForm, compareAt: e.target.value })} placeholder="e.g. 29.99 for strikethrough" className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Stock (blank = unlimited)</label>
                <input value={pForm.stock} onChange={(e) => setPForm({ ...pForm, stock: e.target.value })} placeholder="e.g. 100" className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">SKU</label>
                <input value={pForm.sku} onChange={(e) => setPForm({ ...pForm, sku: e.target.value })} placeholder="e.g. LIC-PREM-01" className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm font-mono" />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-[11px] text-text-muted mb-1">Image URL</label>
                <input value={pForm.imageUrl} onChange={(e) => setPForm({ ...pForm, imageUrl: e.target.value })} placeholder="https://... or /uploads/..." className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Activations (for licenses)</label>
                <input type="number" min={1} max={100} value={pForm.maxActivations} onChange={(e) => setPForm({ ...pForm, maxActivations: e.target.value })} className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Duration Days (blank = forever)</label>
                <input value={pForm.durationDays} onChange={(e) => setPForm({ ...pForm, durationDays: e.target.value })} placeholder="e.g. 30" className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Kind</label>
                <select value={pForm.kind} onChange={(e) => setPForm({ ...pForm, kind: e.target.value })} className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm">
                  <option value="onetime">One-time</option>
                  <option value="subscription">Subscription (Stripe)</option>
                </select>
              </div>
              {pForm.kind === "subscription" && (
                <div>
                  <label className="block text-[11px] text-text-muted mb-1">Billing Interval</label>
                  <select value={pForm.interval} onChange={(e) => setPForm({ ...pForm, interval: e.target.value })} className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm">
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Sort Order</label>
                <input value={pForm.sortOrder} onChange={(e) => setPForm({ ...pForm, sortOrder: e.target.value })} className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div className="lg:col-span-3 flex flex-wrap gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={pForm.featured} onChange={(e) => setPForm({ ...pForm, featured: e.target.checked })} /> ⭐ Featured
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={pForm.active} onChange={(e) => setPForm({ ...pForm, active: e.target.checked })} /> ✅ Active (visible in store)
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={pForm.allowQuantity} onChange={(e) => setPForm({ ...pForm, allowQuantity: e.target.checked })} /> 🔢 Allow quantity selection
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void createOrUpdateProduct()} disabled={busy} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium disabled:opacity-40">
                {busy ? "Saving..." : editingId ? "💾 Update Product" : "➕ Create Product"}
              </button>
              {editingId && <button onClick={() => { setEditingId(null); setPForm({ name: "", description: "", price: "9.99", compareAt: "", category: "general", productType: "license", stock: "", sku: "", badge: "", featured: false, active: true, allowQuantity: true, maxActivations: "1", durationDays: "", kind: "onetime", interval: "month", imageUrl: "", sortOrder: "0" }); }} className="px-4 py-2 bg-bg-secondary border border-border rounded-lg text-sm">Cancel</button>}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-bg-card p-4">
            <h3 className="font-semibold text-sm mb-3">📦 All Products</h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {products.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg bg-bg-secondary px-3 py-2.5">
                  <div className="w-10 h-10 rounded-lg bg-bg-card border border-border flex items-center justify-center text-lg overflow-hidden flex-shrink-0">
                    {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" /> : p.productType === "license" ? "🔑" : p.productType === "server" ? "🎮" : p.productType === "digital" ? "💾" : "📦"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{p.name}</span>
                      {p.badge && <span className="px-1.5 py-0.5 bg-accent/20 text-accent rounded text-[10px] font-bold">{p.badge}</span>}
                      {p.featured && <span className="text-[10px]">⭐</span>}
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${p.active ? "bg-success/15 text-success" : "bg-text-muted/15 text-text-muted"}`}>{p.active ? "active" : "hidden"}</span>
                    </div>
                    <div className="text-[11px] text-text-muted truncate">
                      {p.category} · {p.productType} · ${(p.priceCents / 100).toFixed(2)} {p.compareAtPriceCents ? `(was $${(p.compareAtPriceCents / 100).toFixed(2)})` : ""} · {p.stockQuantity !== null ? `${p.stockQuantity} in stock` : "∞ stock"} · {p.sku || "no SKU"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => startEdit(p)} className="px-2.5 py-1 rounded-lg bg-bg-card border border-border text-[11px] hover:border-accent/30">Edit</button>
                    <button onClick={() => void toggleProduct(p.id, p.active)} disabled={busy} className="px-2.5 py-1 rounded-lg bg-bg-card border border-border text-[11px] hover:border-accent/30 disabled:opacity-40">{p.active ? "Hide" : "Show"}</button>
                    <button onClick={() => void deleteProduct(p.id)} disabled={busy} className="px-2.5 py-1 rounded-lg bg-danger/10 border border-danger/20 text-danger text-[11px] hover:bg-danger/20 disabled:opacity-40">Del</button>
                  </div>
                </div>
              ))}
              {products.length === 0 && <p className="text-xs text-text-muted text-center py-8">No products yet — create your first product above.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Orders */}
      {tab === "orders" && (
        <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
          <h3 className="font-semibold text-sm">🧾 Orders (newest first, 200 max)</h3>
          <div className="space-y-1.5 max-h-[700px] overflow-y-auto">
            {orders.map((o) => (
              <div key={o.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-2">
                <span className="font-mono text-xs font-bold">#{o.id}</span>
                <span className="text-xs truncate max-w-[160px]">{o.email}</span>
                <span className="text-[11px] text-text-muted truncate max-w-[140px]">{o.productName ?? "?"} {o.quantity && o.quantity > 1 ? `x${o.quantity}` : ""} · {o.amountLabel}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${o.status === "fulfilled" ? "bg-success/15 text-success" : o.status === "pending" ? "bg-warning/15 text-warning" : o.status === "paid" ? "bg-accent/15 text-accent" : o.status === "refunded" ? "bg-text-muted/15 text-text-muted" : "bg-danger/15 text-danger"}`}>{o.status}</span>
                <span className="text-[10px] text-text-muted">{new Date(o.createdAt).toLocaleDateString()}</span>
                <span className="flex-1" />
                {o.status === "pending" && o.provider === "manual" && <button onClick={() => void approveOrder(o.id, o.email)} disabled={busy} className="px-2.5 py-1 rounded-lg bg-accent text-white text-[11px] font-medium hover:bg-accent-hover disabled:opacity-40">Approve</button>}
                {o.status === "pending" && <button onClick={() => void refundOrder(o.id, o.email, o.status)} disabled={busy} className="px-2 py-1 text-[11px] text-text-muted hover:text-danger disabled:opacity-40">Cancel</button>}
                {(o.status === "paid" || o.status === "fulfilled") && <button onClick={() => void refundOrder(o.id, o.email, o.status)} disabled={busy} className="px-2 py-1 text-[11px] text-danger/80 hover:text-danger disabled:opacity-40">Refund</button>}
              </div>
            ))}
            {orders.length === 0 && <p className="text-xs text-text-muted text-center py-8">No orders yet — share your storefront link!</p>}
          </div>
        </div>
      )}

      {/* Coupons */}
      {tab === "coupons" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">🎟️ Create Coupon</h3>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Code</label>
                <input value={cCode} onChange={(e) => setCCode(e.target.value.toUpperCase())} placeholder="SUMMER25" className="w-36 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm font-mono uppercase" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Type</label>
                <select value={cKind} onChange={(e) => setCKind(e.target.value as any)} className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm">
                  <option value="percent">% off</option>
                  <option value="fixed">$ off (cents)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Value</label>
                <input value={cValue} onChange={(e) => setCValue(e.target.value)} className="w-20 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Max Uses</label>
                <input value={cMax} onChange={(e) => setCMax(e.target.value)} placeholder="∞" className="w-20 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Product (optional)</label>
                <select value={cProduct} onChange={(e) => setCProduct(e.target.value)} className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm min-w-[140px]">
                  <option value="">All products</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <button onClick={() => void createCoupon()} disabled={busy || !cCode.trim()} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40">Add Coupon</button>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-bg-card p-4">
            <h3 className="font-semibold text-sm mb-3">Active Coupons</h3>
            <div className="space-y-1.5">
              {coupons.map((c) => (
                <div key={c.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-2">
                  <code className="text-sm font-mono font-bold">{c.code}</code>
                  <span className="text-xs text-text-muted">{c.kind === "percent" ? `${c.value}% off` : `$${(c.value / 100).toFixed(2)} off`} · {c.productId ? `for ${c.productName ?? "product"}` : "all products"} · {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""} used {c.expiresAt ? `· until ${new Date(c.expiresAt).toLocaleDateString()}` : ""}</span>
                  <span className="flex-1" />
                  <button onClick={() => void toggleCoupon(c.id, c.active)} disabled={busy} className={`text-xs px-2.5 py-1 rounded-lg border ${c.active ? "bg-success/10 border-success/20 text-success" : "bg-bg-card border-border text-text-muted"} disabled:opacity-40`}>{c.active ? "Active ✓" : "Disabled"}</button>
                </div>
              ))}
              {coupons.length === 0 && <p className="text-xs text-text-muted">No coupons yet</p>}
            </div>
          </div>
        </div>
      )}

      {/* Resellers */}
      {tab === "resellers" && (
        <div className="space-y-4">
          {rToken && (
            <div className="rounded-xl border border-success/40 bg-success/10 p-4 space-y-2">
              <p className="text-sm font-semibold text-success">Reseller token for “{rToken.label}” — shown only once:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-bg-card border border-border px-3 py-2 text-xs font-mono">{rToken.token}</code>
                <button onClick={() => { void navigator.clipboard.writeText(rToken.token).then(() => toast.success("Copied", "Token copied")); }} className="px-3 py-2 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover">Copy</button>
                <button onClick={() => setRToken(null)} className="px-3 py-2 text-xs text-text-muted hover:text-text-primary">Done</button>
              </div>
              <p className="text-[11px] text-text-muted">Give this to the reseller — they send it as X-Reseller-Token header or resellerToken field at checkout.</p>
            </div>
          )}
          <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">🤝 Add Reseller</h3>
            <div className="flex flex-wrap gap-2">
              <input value={rLabel} onChange={(e) => setRLabel(e.target.value)} placeholder="Reseller name, e.g. GameShop AU" className="flex-1 min-w-[200px] rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-xs">
                Commission %
                <input type="number" min={0} max={90} value={rPct} onChange={(e) => setRPct(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} className="w-16 rounded-lg border border-border bg-bg-secondary px-2 py-2 text-sm" />
              </label>
              <button onClick={() => void createReseller()} disabled={busy || !rLabel.trim()} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40">Add Reseller</button>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-bg-card p-4">
            <h3 className="font-semibold text-sm mb-3">Resellers</h3>
            <div className="space-y-1.5">
              {resellers.map((r) => (
                <div key={r.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-2">
                  <span className="text-sm font-medium">{r.label}</span>
                  <span className="text-[11px] text-text-muted font-mono">{r.tokenPrefix}… · {r.commissionPct}% · {r.orderCount} orders · ${(r.salesCents / 100).toFixed(2)} sold · ${(r.commissionCents / 100).toFixed(2)} earned {r.lastUsedAt ? `· last ${new Date(r.lastUsedAt).toLocaleDateString()}` : ""}</span>
                  <span className="flex-1" />
                  <button onClick={() => void toggleReseller(r.id, r.active)} disabled={busy} className={`text-xs px-2.5 py-1 rounded-lg border ${r.active ? "bg-success/10 border-success/20 text-success" : "bg-bg-card border-border text-text-muted"} disabled:opacity-40`}>{r.active ? "Active ✓" : "Disabled"}</button>
                </div>
              ))}
              {resellers.length === 0 && <p className="text-xs text-text-muted">No resellers yet</p>}
            </div>
          </div>
        </div>
      )}

      {/* Categories */}
      {tab === "categories" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">📂 Add Category</h3>
            <div className="flex flex-wrap gap-2">
              <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Category name" className="flex-1 min-w-[160px] rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              <input value={catSlug} onChange={(e) => setCatSlug(e.target.value)} placeholder="slug (auto)" className="w-32 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              <input value={catIcon} onChange={(e) => setCatIcon(e.target.value)} placeholder="Icon" className="w-16 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
              <button onClick={() => void createCategory()} disabled={busy || !catName.trim()} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40">Add</button>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-bg-card p-4">
            <h3 className="font-semibold text-sm mb-3">Categories</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg bg-bg-secondary px-3 py-2">
                  <span className="text-lg">{c.icon || "🛒"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-[11px] text-text-muted">/{c.slug} · {c.description || "No description"}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] ${c.active ? "bg-success/15 text-success" : "bg-text-muted/15 text-text-muted"}`}>{c.active ? "active" : "hidden"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";

interface ShopProduct {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  priceLabel: string;
  compareAtPriceCents: number | null;
  compareAtLabel: string | null;
  maxActivations: number;
  durationDays: number | null;
  imageUrl: string | null;
  category: string;
  productType: string;
  stockQuantity: number | null;
  featured: boolean;
  sku: string | null;
  badge: string | null;
  allowQuantity: boolean;
  kind: string;
  billingInterval: string | null;
}

interface ShopCategory {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
}

interface CartItem {
  product: ShopProduct;
  quantity: number;
}

export default function PublicShop() {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [activeCat, setActiveCat] = useState("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [email, setEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponInfo, setCouponInfo] = useState<{ ok: boolean; text: string; savings?: number } | null>(null);
  const [buying, setBuying] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string; orderId?: number } | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ShopProduct | null>(null);

  const loadShop = useCallback(async () => {
    try {
      const res = await fetch("/api/shop/products");
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setProducts(data.products ?? []);
        setCategories(data.categories ?? []);
        setStripeEnabled(data.stripeEnabled === true);
      }
    } catch {}
    finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadShop(), 0);
    return () => clearTimeout(t);
  }, [loadShop]);

  // Cart persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem("shop_cart");
      if (saved) {
        const parsed = JSON.parse(saved) as CartItem[];
        if (Array.isArray(parsed)) setCart(parsed);
      }
      const savedEmail = localStorage.getItem("shop_email");
      if (savedEmail) setEmail(savedEmail);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("shop_cart", JSON.stringify(cart));
    } catch {}
  }, [cart]);

  useEffect(() => {
    if (email) {
      try { localStorage.setItem("shop_email", email); } catch {}
    }
  }, [email]);

  const cartTotal = cart.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  function addToCart(product: ShopProduct, qty = 1) {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (!product.allowQuantity) return prev;
        return prev.map((i) => i.product.id === product.id ? { ...i, quantity: Math.min(100, i.quantity + qty) } : i);
      }
      return [...prev, { product, quantity: qty }];
    });
    setShowCart(true);
  }

  function updateQty(productId: number, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.product.id !== productId));
    } else {
      setCart((prev) => prev.map((i) => i.product.id === productId ? { ...i, quantity: Math.min(100, qty) } : i));
    }
  }

  function removeFromCart(productId: number) {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  }

  async function checkCoupon() {
    if (!coupon.trim() || cart.length === 0) { setCouponInfo(null); return; }
    try {
      // Use first product price for preview
      const price = cart[0].product.priceCents * cart[0].quantity;
      const res = await fetch(`/api/shop/coupons/check?code=${encodeURIComponent(coupon.trim())}&priceCents=${price}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setCouponInfo({ ok: true, text: `✓ ${data.code} applied — you save $${(data.savingsCents / 100).toFixed(2)}!`, savings: data.savingsCents });
      } else {
        setCouponInfo({ ok: false, text: data?.error || "That coupon is not valid." });
      }
    } catch {
      setCouponInfo({ ok: false, text: "Could not check coupon." });
    }
  }

  async function checkout() {
    if (buying || cart.length === 0) return;
    if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setMessage({ kind: "err", text: "Enter a valid email first — your order details go there." });
      return;
    }
    setBuying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/shop/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          customerName: customerName.trim() || undefined,
          provider: stripeEnabled ? "stripe" : "manual",
          couponCode: coupon.trim() || undefined,
          items: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ kind: "err", text: data?.error || "Could not place order." });
        return;
      }
      if (data?.redirect) {
        setMessage({ kind: "ok", text: "Redirecting to secure payment…", orderId: data.orderId });
        window.location.assign(data.redirect);
        return;
      }
      setMessage({
        kind: "ok",
        text: data?.message || `Order placed! ${data.orderIds?.length ? `Orders: #${data.orderIds.join(", #")}` : `Order #${data.orderId}`}`,
        orderId: data.orderId,
      });
      setCart([]);
      setCoupon("");
      setCouponInfo(null);
    } catch {
      setMessage({ kind: "err", text: "Network error — please try again." });
    } finally {
      setBuying(false);
    }
  }

  const filtered = products.filter((p) => {
    if (activeCat !== "all" && p.category !== activeCat) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)) || (p.sku && p.sku.toLowerCase().includes(q));
    }
    return true;
  });

  const featured = filtered.filter((p) => p.featured);
  const regular = filtered.filter((p) => !p.featured);

  const typeIcon = (t: string) => {
    switch (t) {
      case "license": return "🔑";
      case "server": return "🎮";
      case "digital": return "💾";
      case "physical": return "📦";
      case "service": return "🛠️";
      case "subscription": return "🔁";
      case "merch": return "👕";
      default: return "🛒";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + cart */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">🛒 Store</h2>
          <p className="text-sm text-text-secondary">Licenses, game servers, digital goods and services — instant delivery.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products, SKU…" className="w-64 pl-9 pr-3 py-2 bg-bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            <span className="absolute left-3 top-2.5 text-text-muted text-sm">🔍</span>
          </div>
          <button onClick={() => setShowCart(!showCart)} className="relative px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent-hover transition-colors">
            🛍️ Cart {cartCount > 0 && <span className="ml-1 bg-white text-accent rounded-full px-1.5 py-0.5 text-[10px] font-bold">{cartCount}</span>}
          </button>
        </div>
      </div>

      {/* Categories */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setActiveCat("all")} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeCat === "all" ? "bg-accent text-white border-accent" : "bg-bg-card border-border text-text-secondary hover:border-accent/30"}`}>All</button>
        {categories.map((c) => (
          <button key={c.slug} onClick={() => setActiveCat(c.slug)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeCat === c.slug ? "bg-accent text-white border-accent" : "bg-bg-card border-border text-text-secondary hover:border-accent/30"}`}>
            {c.icon || "📦"} {c.name}
          </button>
        ))}
        {/* fallback if no categories from API, use product categories */}
        {categories.length === 0 && [...new Set(products.map((p) => p.category))].map((cat) => (
          <button key={cat} onClick={() => setActiveCat(cat)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeCat === cat ? "bg-accent text-white border-accent" : "bg-bg-card border-border text-text-secondary hover:border-accent/30"}`}>{cat}</button>
        ))}
      </div>

      {/* Cart drawer */}
      {showCart && (
        <div className="rounded-2xl border border-border bg-bg-card p-5 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Your Cart ({cartCount})</h3>
            <button onClick={() => setShowCart(false)} className="text-text-muted hover:text-text-primary text-sm">✕ Close</button>
          </div>
          {cart.length === 0 ? (
            <p className="text-sm text-text-muted py-4 text-center">Your cart is empty — add some products!</p>
          ) : (
            <>
              <div className="space-y-2 max-h-[320px] overflow-y-auto">
                {cart.map((item) => (
                  <div key={item.product.id} className="flex items-center gap-3 rounded-xl bg-bg-secondary p-3">
                    <div className="w-12 h-12 rounded-lg bg-bg-card border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                      {item.product.imageUrl ? <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover" /> : <span className="text-lg">{typeIcon(item.product.productType)}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.product.name}</p>
                      <p className="text-xs text-text-muted">{item.product.priceLabel} {item.product.billingInterval ? `/ ${item.product.billingInterval}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {item.product.allowQuantity ? (
                        <>
                          <button onClick={() => updateQty(item.product.id, item.quantity - 1)} className="w-7 h-7 rounded-lg bg-bg-card border border-border text-xs hover:border-accent/30">−</button>
                          <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                          <button onClick={() => updateQty(item.product.id, item.quantity + 1)} className="w-7 h-7 rounded-lg bg-bg-card border border-border text-xs hover:border-accent/30">+</button>
                        </>
                      ) : (
                        <span className="text-xs text-text-muted">x{item.quantity}</span>
                      )}
                    </div>
                    <div className="text-sm font-bold w-20 text-right">${((item.product.priceCents * item.quantity) / 100).toFixed(2)}</div>
                    <button onClick={() => removeFromCart(item.product.id)} className="text-danger/60 hover:text-danger text-xs ml-1">✕</button>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-text-muted mb-1">Email * (delivery)</label>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-text-muted mb-1">Name (optional)</label>
                    <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Your name" className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <input value={coupon} onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setCouponInfo(null); }} placeholder="Coupon code" className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm font-mono uppercase" />
                  <button onClick={() => void checkCoupon()} className="px-4 py-2 bg-bg-secondary border border-border rounded-lg text-xs font-medium hover:border-accent/30">Check</button>
                </div>
                {couponInfo && <p className={`text-xs ${couponInfo.ok ? "text-success" : "text-danger"}`}>{couponInfo.text}</p>}
                <div className="flex items-center justify-between pt-2">
                  <div>
                    <p className="text-sm font-bold">Total: ${(cartTotal / 100).toFixed(2)} {couponInfo?.ok && couponInfo.savings ? <span className="text-success text-xs font-normal"> (savings applied at checkout)</span> : ""}</p>
                    <p className="text-[11px] text-text-muted">{stripeEnabled ? "Secure card payment via Stripe" : "Manual approval — operator will email you"}</p>
                  </div>
                  <button onClick={() => void checkout()} disabled={buying} className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                    {buying ? "Processing…" : stripeEnabled ? "💳 Checkout" : "📦 Place Order"}
                  </button>
                </div>
                {message && (
                  <div className={`rounded-xl border px-4 py-3 text-sm ${message.kind === "ok" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}>
                    <p className="font-medium">{message.text}</p>
                    {message.orderId && <p className="text-xs mt-1">Track: <a href={`/shop/order/${message.orderId}?email=${encodeURIComponent(email)}`} className="underline">Order #{message.orderId}</a> · <a href="/shop/track" className="underline">Track order</a></p>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Products */}
      {!loaded ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map((i) => <div key={i} className="h-64 rounded-2xl bg-bg-card border border-border animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-2xl bg-bg-card border border-border">
          <span className="text-4xl block mb-3">🛒</span>
          <h3 className="font-semibold mb-1">No products found</h3>
          <p className="text-sm text-text-muted">Try a different category or search term.</p>
        </div>
      ) : (
        <>
          {featured.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">⭐ Featured</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {featured.map((p) => (
                  <ProductCard key={p.id} product={p} onAdd={addToCart} onView={setSelectedProduct} typeIcon={typeIcon} />
                ))}
              </div>
            </div>
          )}
          <div className="space-y-3">
            {featured.length > 0 && <h3 className="font-semibold">All Products</h3>}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {regular.map((p) => (
                <ProductCard key={p.id} product={p} onAdd={addToCart} onView={setSelectedProduct} typeIcon={typeIcon} />
              ))}
              {featured.length === 0 && filtered.map((p) => (
                <ProductCard key={p.id} product={p} onAdd={addToCart} onView={setSelectedProduct} typeIcon={typeIcon} />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Product detail modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedProduct(null)}>
          <div className="w-full max-w-2xl bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              {selectedProduct.imageUrl ? (
                <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-full h-64 object-cover" />
              ) : (
                <div className="w-full h-48 bg-bg-secondary flex items-center justify-center text-5xl">{typeIcon(selectedProduct.productType)}</div>
              )}
              {selectedProduct.badge && <span className="absolute top-3 left-3 px-2.5 py-1 bg-accent text-white rounded-full text-xs font-bold">{selectedProduct.badge}</span>}
              <button onClick={() => setSelectedProduct(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-xl font-bold">{selectedProduct.name}</h3>
                  <span className="px-2 py-1 bg-bg-secondary border border-border rounded-full text-[11px]">{typeIcon(selectedProduct.productType)} {selectedProduct.productType}</span>
                </div>
                <p className="text-sm text-text-secondary mt-2 leading-relaxed whitespace-pre-wrap">{selectedProduct.description || "No description."}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 bg-bg-secondary rounded-full border border-border">📦 {selectedProduct.category}</span>
                {selectedProduct.sku && <span className="px-2.5 py-1 bg-bg-secondary rounded-full border border-border font-mono">SKU: {selectedProduct.sku}</span>}
                <span className="px-2.5 py-1 bg-bg-secondary rounded-full border border-border">🔑 {selectedProduct.maxActivations} activation{selectedProduct.maxActivations !== 1 ? "s" : ""}</span>
                <span className="px-2.5 py-1 bg-bg-secondary rounded-full border border-border">{selectedProduct.durationDays ? `⏳ ${selectedProduct.durationDays} days` : "♾️ Never expires"}</span>
                {selectedProduct.stockQuantity !== null && <span className={`px-2.5 py-1 rounded-full border ${selectedProduct.stockQuantity > 0 ? "bg-success/10 border-success/20 text-success" : "bg-danger/10 border-danger/20 text-danger"}`}>{selectedProduct.stockQuantity > 0 ? `${selectedProduct.stockQuantity} in stock` : "Out of stock"}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold">{selectedProduct.priceLabel}</span>
                {selectedProduct.compareAtLabel && <span className="text-sm text-text-muted line-through">{selectedProduct.compareAtLabel}</span>}
                {selectedProduct.kind === "subscription" && <span className="text-xs text-accent">/ {selectedProduct.billingInterval === "year" ? "year" : "month"}</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { addToCart(selectedProduct); setSelectedProduct(null); }} className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold">Add to Cart</button>
                <button onClick={() => setSelectedProduct(null)} className="px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm">Close</button>
              </div>
              <p className="text-[11px] text-text-muted">Secure checkout · Instant delivery for licenses · Email support included</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-bg-card p-4 text-center">
        <p className="text-xs text-text-muted">Need help? <a href="/shop/track" className="text-accent hover:underline">Track your order</a> · <a href="/license" className="text-accent hover:underline">Check license</a> · Contact support via the forum.</p>
      </div>
    </div>
  );
}

function ProductCard({ product, onAdd, onView, typeIcon }: { product: ShopProduct; onAdd: (p: ShopProduct) => void; onView: (p: ShopProduct) => void; typeIcon: (t: string) => string }) {
  const outOfStock = product.stockQuantity !== null && product.stockQuantity <= 0;
  return (
    <div className="group relative rounded-2xl border border-border bg-bg-card overflow-hidden hover:border-accent/30 hover:shadow-lg transition-all flex flex-col">
      <div className="relative h-40 bg-bg-secondary overflow-hidden">
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-accent/10 to-purple/10">{typeIcon(product.productType)}</div>}
        <div className="absolute top-2 left-2 flex gap-1.5">
          {product.badge && <span className="px-2 py-0.5 bg-accent text-white rounded-full text-[10px] font-bold shadow">{product.badge}</span>}
          {product.featured && <span className="px-2 py-0.5 bg-warning text-black rounded-full text-[10px] font-bold shadow">⭐ Featured</span>}
        </div>
        {product.compareAtPriceCents && product.compareAtPriceCents > product.priceCents && <span className="absolute top-2 right-2 px-2 py-0.5 bg-danger text-white rounded-full text-[10px] font-bold shadow">Sale</span>}
        {outOfStock && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><span className="px-3 py-1 bg-danger text-white rounded-full text-xs font-bold">Out of Stock</span></div>}
      </div>
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 flex-1">{product.name}</h3>
          <span className="text-[10px] px-1.5 py-0.5 bg-bg-secondary border border-border rounded-full flex-shrink-0">{typeIcon(product.productType)}</span>
        </div>
        <p className="text-xs text-text-secondary line-clamp-2 flex-1">{product.description || "No description."}</p>
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <span>{product.category}</span>
          {product.sku && <span className="font-mono">· {product.sku}</span>}
        </div>
        <div className="flex items-end justify-between gap-2 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{product.priceLabel}</span>
              {product.compareAtLabel && <span className="text-xs text-text-muted line-through">{product.compareAtLabel}</span>}
            </div>
            {product.kind === "subscription" && <p className="text-[10px] text-accent">per {product.billingInterval === "year" ? "year" : "month"} · renews</p>}
            {product.productType === "license" && <p className="text-[10px] text-text-muted">{product.maxActivations} act · {product.durationDays ? `${product.durationDays}d` : "∞"}</p>}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => onView(product)} className="px-2.5 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs hover:border-accent/30">View</button>
            <button onClick={() => onAdd(product)} disabled={outOfStock} className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed">Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

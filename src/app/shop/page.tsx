"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

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

export default function ShopPage() {
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
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string; orderId?: number; orderIds?: number[] } | null>(null);
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
    try { localStorage.setItem("shop_cart", JSON.stringify(cart)); } catch {}
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
    if (qty <= 0) setCart((prev) => prev.filter((i) => i.product.id !== productId));
    else setCart((prev) => prev.map((i) => i.product.id === productId ? { ...i, quantity: Math.min(100, qty) } : i));
  }

  function removeFromCart(productId: number) {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  }

  async function checkCoupon() {
    if (!coupon.trim() || cart.length === 0) { setCouponInfo(null); return; }
    try {
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
        setMessage({ kind: "ok", text: "Redirecting to secure payment…", orderId: data.orderId, orderIds: data.orderIds });
        window.location.assign(data.redirect);
        return;
      }
      setMessage({
        kind: "ok",
        text: data?.message || `Order placed! #${data.orderId}`,
        orderId: data.orderId,
        orderIds: data.orderIds,
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
    <main className="min-h-screen bg-[#0b0f17] text-[#e2e8f0]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="px-3 py-1.5 rounded-lg bg-[#111827] border border-[#1f2937] text-sm hover:border-[#6366f1]/50 transition-colors">← Home</Link>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">🛒 Store</h1>
              <p className="text-sm text-[#94a3b8]">Licenses, game servers, digital goods and services — instant delivery.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products, SKU…" className="w-64 pl-9 pr-3 py-2.5 bg-[#111827] border border-[#1f2937] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6366f1] text-white placeholder:text-[#64748b]" />
              <span className="absolute left-3 top-2.5 text-[#64748b] text-sm">🔍</span>
            </div>
            <button onClick={() => setShowCart(!showCart)} className="relative px-4 py-2.5 bg-[#6366f1] text-white rounded-xl text-sm font-semibold hover:bg-[#4f46e5] transition-colors">
              🛍️ Cart {cartCount > 0 && <span className="ml-1 bg-white text-[#6366f1] rounded-full px-1.5 py-0.5 text-[10px] font-bold">{cartCount}</span>}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setActiveCat("all")} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeCat === "all" ? "bg-[#6366f1] text-white border-[#6366f1]" : "bg-[#111827] border-[#1f2937] text-[#94a3b8] hover:border-[#6366f1]/30"}`}>All</button>
          {categories.map((c) => (
            <button key={c.slug} onClick={() => setActiveCat(c.slug)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeCat === c.slug ? "bg-[#6366f1] text-white border-[#6366f1]" : "bg-[#111827] border-[#1f2937] text-[#94a3b8] hover:border-[#6366f1]/30"}`}>
              {c.icon || "📦"} {c.name}
            </button>
          ))}
          {categories.length === 0 && [...new Set(products.map((p) => p.category))].map((cat) => (
            <button key={cat} onClick={() => setActiveCat(cat)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeCat === cat ? "bg-[#6366f1] text-white border-[#6366f1]" : "bg-[#111827] border-[#1f2937] text-[#94a3b8] hover:border-[#6366f1]/30"}`}>{cat}</button>
          ))}
        </div>

        {showCart && (
          <div className="rounded-2xl border border-[#1f2937] bg-[#111827] p-5 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Your Cart ({cartCount})</h3>
              <button onClick={() => setShowCart(false)} className="text-[#64748b] hover:text-white text-sm">✕ Close</button>
            </div>
            {cart.length === 0 ? (
              <p className="text-sm text-[#64748b] py-4 text-center">Your cart is empty — add some products!</p>
            ) : (
              <>
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {cart.map((item) => (
                    <div key={item.product.id} className="flex items-center gap-3 rounded-xl bg-[#0b0f17] border border-[#1f2937] p-3">
                      <div className="w-12 h-12 rounded-lg bg-[#111827] border border-[#1f2937] flex items-center justify-center overflow-hidden flex-shrink-0">
                        {item.product.imageUrl ? <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover" /> : <span className="text-lg">{typeIcon(item.product.productType)}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate text-white">{item.product.name}</p>
                        <p className="text-xs text-[#94a3b8]">{item.product.priceLabel} {item.product.billingInterval ? `/ ${item.product.billingInterval}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {item.product.allowQuantity ? (
                          <>
                            <button onClick={() => updateQty(item.product.id, item.quantity - 1)} className="w-7 h-7 rounded-lg bg-[#111827] border border-[#1f2937] text-xs hover:border-[#6366f1]/30 text-white">−</button>
                            <span className="w-8 text-center text-sm font-medium text-white">{item.quantity}</span>
                            <button onClick={() => updateQty(item.product.id, item.quantity + 1)} className="w-7 h-7 rounded-lg bg-[#111827] border border-[#1f2937] text-xs hover:border-[#6366f1]/30 text-white">+</button>
                          </>
                        ) : (
                          <span className="text-xs text-[#64748b]">x{item.quantity}</span>
                        )}
                      </div>
                      <div className="text-sm font-bold w-20 text-right text-white">${((item.product.priceCents * item.quantity) / 100).toFixed(2)}</div>
                      <button onClick={() => removeFromCart(item.product.id)} className="text-[#ef4444]/60 hover:text-[#ef4444] text-xs ml-1">✕</button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-[#1f2937] pt-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#94a3b8] mb-1">Email * (delivery)</label>
                      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" className="w-full rounded-lg border border-[#1f2937] bg-[#0b0f17] px-3 py-2.5 text-sm text-white placeholder:text-[#64748b] focus:outline-none focus:ring-2 focus:ring-[#6366f1]" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#94a3b8] mb-1">Name (optional)</label>
                      <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Your name" className="w-full rounded-lg border border-[#1f2937] bg-[#0b0f17] px-3 py-2.5 text-sm text-white placeholder:text-[#64748b] focus:outline-none focus:ring-2 focus:ring-[#6366f1]" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input value={coupon} onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setCouponInfo(null); }} placeholder="Coupon code" className="flex-1 rounded-lg border border-[#1f2937] bg-[#0b0f17] px-3 py-2.5 text-sm font-mono uppercase text-white placeholder:text-[#64748b] focus:outline-none focus:ring-2 focus:ring-[#6366f1]" />
                    <button onClick={() => void checkCoupon()} className="px-4 py-2.5 bg-[#1f2937] border border-[#374151] rounded-lg text-xs font-medium hover:border-[#6366f1]/30 text-white">Check</button>
                  </div>
                  {couponInfo && <p className={`text-xs ${couponInfo.ok ? "text-[#22c55e]" : "text-[#ef4444]"}`}>{couponInfo.text}</p>}
                  <div className="flex items-center justify-between pt-2 flex-wrap gap-3">
                    <div>
                      <p className="text-sm font-bold text-white">Total: ${(cartTotal / 100).toFixed(2)} {couponInfo?.ok && couponInfo.savings ? <span className="text-[#22c55e] text-xs font-normal"> (savings applied at checkout)</span> : ""}</p>
                      <p className="text-[11px] text-[#64748b]">{stripeEnabled ? "Secure card payment via Stripe" : "Manual approval — operator will email you"}</p>
                    </div>
                    <button onClick={() => void checkout()} disabled={buying} className="px-6 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">
                      {buying ? "Processing…" : stripeEnabled ? "💳 Checkout" : "📦 Place Order"}
                    </button>
                  </div>
                  {message && (
                    <div className={`rounded-xl border px-4 py-3 text-sm ${message.kind === "ok" ? "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#22c55e]" : "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]"}`}>
                      <p className="font-medium">{message.text}</p>
                      {message.orderId && <p className="text-xs mt-1 text-[#94a3b8]">Track: <a href={`/shop/order/${message.orderId}?email=${encodeURIComponent(email)}`} className="underline text-[#818cf8]">Order #{message.orderId}</a> · <a href="/shop/track" className="underline text-[#818cf8]">Track order</a></p>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {!loaded ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3,4,5,6].map((i) => <div key={i} className="h-64 rounded-2xl bg-[#111827] border border-[#1f2937] animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 rounded-2xl bg-[#111827] border border-[#1f2937]">
            <span className="text-4xl block mb-3">🛒</span>
            <h3 className="font-semibold mb-1 text-white">No products found</h3>
            <p className="text-sm text-[#64748b]">Try a different category or search term.</p>
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2 text-white">⭐ Featured</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {featured.map((p) => (
                    <ProductCard key={p.id} product={p} onAdd={addToCart} onView={setSelectedProduct} typeIcon={typeIcon} />
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-3">
              {featured.length > 0 && <h3 className="font-semibold text-white">All Products</h3>}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(featured.length > 0 ? regular : filtered).map((p) => (
                  <ProductCard key={p.id} product={p} onAdd={addToCart} onView={setSelectedProduct} typeIcon={typeIcon} />
                ))}
              </div>
            </div>
          </>
        )}

        {selectedProduct && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedProduct(null)}>
            <div className="w-full max-w-2xl bg-[#111827] border border-[#1f2937] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="relative">
                {selectedProduct.imageUrl ? (
                  <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-full h-64 object-cover" />
                ) : (
                  <div className="w-full h-48 bg-[#0b0f17] flex items-center justify-center text-5xl">{typeIcon(selectedProduct.productType)}</div>
                )}
                {selectedProduct.badge && <span className="absolute top-3 left-3 px-2.5 py-1 bg-[#6366f1] text-white rounded-full text-xs font-bold">{selectedProduct.badge}</span>}
                <button onClick={() => setSelectedProduct(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70">✕</button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-xl font-bold text-white">{selectedProduct.name}</h3>
                    <span className="px-2 py-1 bg-[#0b0f17] border border-[#1f2937] rounded-full text-[11px] text-[#94a3b8]">{typeIcon(selectedProduct.productType)} {selectedProduct.productType}</span>
                  </div>
                  <p className="text-sm text-[#94a3b8] mt-2 leading-relaxed whitespace-pre-wrap">{selectedProduct.description || "No description."}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 bg-[#0b0f17] rounded-full border border-[#1f2937] text-[#94a3b8]">📦 {selectedProduct.category}</span>
                  {selectedProduct.sku && <span className="px-2.5 py-1 bg-[#0b0f17] rounded-full border border-[#1f2937] font-mono text-[#94a3b8]">SKU: {selectedProduct.sku}</span>}
                  <span className="px-2.5 py-1 bg-[#0b0f17] rounded-full border border-[#1f2937] text-[#94a3b8]">🔑 {selectedProduct.maxActivations} act</span>
                  <span className="px-2.5 py-1 bg-[#0b0f17] rounded-full border border-[#1f2937] text-[#94a3b8]">{selectedProduct.durationDays ? `⏳ ${selectedProduct.durationDays} days` : "♾️ Never expires"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-white">{selectedProduct.priceLabel}</span>
                  {selectedProduct.compareAtLabel && <span className="text-sm text-[#64748b] line-through">{selectedProduct.compareAtLabel}</span>}
                  {selectedProduct.kind === "subscription" && <span className="text-xs text-[#818cf8]">/ {selectedProduct.billingInterval === "year" ? "year" : "month"}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { addToCart(selectedProduct); setSelectedProduct(null); }} className="flex-1 px-4 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-semibold">Add to Cart</button>
                  <button onClick={() => setSelectedProduct(null)} className="px-4 py-2.5 bg-[#1f2937] border border-[#374151] rounded-xl text-sm text-white">Close</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-[#1f2937] bg-[#111827] p-4 text-center">
          <p className="text-xs text-[#64748b]">Already bought? <a href="/shop/track" className="text-[#818cf8] hover:underline">Track your order</a> · Need help? <a href="/license" className="text-[#818cf8] hover:underline">Check a key</a> · <Link href="/" className="text-[#818cf8] hover:underline">Home</Link></p>
        </div>
      </div>
    </main>
  );
}

function ProductCard({ product, onAdd, onView, typeIcon }: { product: ShopProduct; onAdd: (p: ShopProduct) => void; onView: (p: ShopProduct) => void; typeIcon: (t: string) => string }) {
  const outOfStock = product.stockQuantity !== null && product.stockQuantity <= 0;
  return (
    <div className="group relative rounded-2xl border border-[#1f2937] bg-[#111827] overflow-hidden hover:border-[#6366f1]/30 hover:shadow-lg transition-all flex flex-col">
      <div className="relative h-40 bg-[#0b0f17] overflow-hidden">
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10">{typeIcon(product.productType)}</div>}
        <div className="absolute top-2 left-2 flex gap-1.5">
          {product.badge && <span className="px-2 py-0.5 bg-[#6366f1] text-white rounded-full text-[10px] font-bold shadow">{product.badge}</span>}
          {product.featured && <span className="px-2 py-0.5 bg-[#eab308] text-black rounded-full text-[10px] font-bold shadow">⭐ Featured</span>}
        </div>
        {product.compareAtPriceCents && product.compareAtPriceCents > product.priceCents && <span className="absolute top-2 right-2 px-2 py-0.5 bg-[#ef4444] text-white rounded-full text-[10px] font-bold shadow">Sale</span>}
        {outOfStock && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><span className="px-3 py-1 bg-[#ef4444] text-white rounded-full text-xs font-bold">Out of Stock</span></div>}
      </div>
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 flex-1 text-white">{product.name}</h3>
          <span className="text-[10px] px-1.5 py-0.5 bg-[#0b0f17] border border-[#1f2937] rounded-full flex-shrink-0 text-[#94a3b8]">{typeIcon(product.productType)}</span>
        </div>
        <p className="text-xs text-[#94a3b8] line-clamp-2 flex-1">{product.description || "No description."}</p>
        <div className="flex items-center gap-2 text-[11px] text-[#64748b]">
          <span>{product.category}</span>
          {product.sku && <span className="font-mono">· {product.sku}</span>}
        </div>
        <div className="flex items-end justify-between gap-2 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">{product.priceLabel}</span>
              {product.compareAtLabel && <span className="text-xs text-[#64748b] line-through">{product.compareAtLabel}</span>}
            </div>
            {product.kind === "subscription" && <p className="text-[10px] text-[#818cf8]">per {product.billingInterval === "year" ? "year" : "month"} · renews</p>}
            {product.productType === "license" && <p className="text-[10px] text-[#64748b]">{product.maxActivations} act · {product.durationDays ? `${product.durationDays}d` : "∞"}</p>}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => onView(product)} className="px-2.5 py-1.5 bg-[#1f2937] border border-[#374151] rounded-lg text-xs hover:border-[#6366f1]/30 text-white">View</button>
            <button onClick={() => onAdd(product)} disabled={outOfStock} className="px-3 py-1.5 bg-[#6366f1] text-white rounded-lg text-xs font-medium hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed">Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

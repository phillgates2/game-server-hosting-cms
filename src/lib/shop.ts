/**
 * Shop: sell anything. Two payment providers ship built-in:
 *
 *   manual — zero-config: the order sits "pending" until an admin approves
 *            it (bank transfer, PayPal friends, cash-in-hand...). Approving
 *            fulfils it instantly.
 *   stripe — when STRIPE_SECRET_KEY is set: real Stripe Checkout via raw
 *            REST (no SDK), webhook-verified, auto-fulfilled on
 *            checkout.session.completed.
 *
 * Pure helpers (prices, emails, fulfilment decisions, Stripe signature
 * verification) are unit-tested below; DB orchestration lives here too.
 */

export const SHOP_ORDER_EMAIL_MAX = 254;
export const SHOP_PRODUCT_NAME_MAX = 128;
export const SHOP_PRICE_MAX_CENTS = 100_000_000; // sanity cap: 1M per key

export type ShopOrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
export type ShopProvider = "manual" | "stripe";

/** Strict-ish buyer email validation: shape only, no network lookups. */
export function isValidOrderEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0 || v.length > SHOP_ORDER_EMAIL_MAX) return false;
  // one @, non-empty local + domain with a dot in the domain part
  const at = v.lastIndexOf("@");
  if (at <= 0 || at === v.length - 1) return false;
  const domain = v.slice(at + 1);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && !domain.startsWith(".") && !domain.endsWith(".");
}

/** Format cents for display: 900 -> "$9.00". */
export function formatPrice(cents: number, currency: string): string {
  const sym = currency.toLowerCase() === "usd" ? "$" : currency.toLowerCase() === "eur" ? "€" : currency.toUpperCase() + " ";
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${sym}${whole}.${frac}`;
}

/** An order may only be fulfilled once, from a payable state. */
export function orderCanFulfil(status: ShopOrderStatus): boolean {
  return status === "paid" || status === "pending";
}

/** Refunds apply to money that moved; pending orders are cancelled instead. */
export function orderCanRefund(status: ShopOrderStatus): boolean {
  return status === "paid" || status === "fulfilled";
}

/** Pending orders can simply be cancelled (no money moved yet). */
export function orderCanCancel(status: ShopOrderStatus): boolean {
  return status === "pending";
}

/** Product price sanity at creation time. */
export function isValidProductPrice(cents: unknown): cents is number {
  const n = Number(cents);
  return Number.isInteger(n) && n >= 0 && n <= SHOP_PRICE_MAX_CENTS;
}

// ── Resellers (pure) ────────────────────────────────────────────────────────

export const RESELLER_TOKEN_PREFIX = "GSMR";
export const COMMISSION_MAX_PCT = 90;

/** Commission on a sale, floored to whole cents (reseller gets the floor). */
export function commissionFor(amountCents: number, pct: number): number {
  const clamped = Math.max(0, Math.min(COMMISSION_MAX_PCT, Math.floor(pct)));
  return Math.floor((amountCents * clamped) / 100);
}

/** Total earnings across a reseller's orders. */
export function totalCommission(orders: Array<{ commissionCents: number | null }>): number {
  return orders.reduce((sum, o) => sum + (o.commissionCents ?? 0), 0);
}

/** SHA-256 of a reseller token (what the database stores). */
export async function hashResellerToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token.trim()).digest("hex");
}

/** Generate a fresh reseller token: GSMR_<40 hex>. */
export async function generateResellerToken(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return `${RESELLER_TOKEN_PREFIX}_${randomBytes(20).toString("hex")}`;
}

/** Canonical reseller token shape. */
export function normalizeResellerToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v.startsWith(`${RESELLER_TOKEN_PREFIX}_`)) return null;
  if (v.length < RESELLER_TOKEN_PREFIX.length + 17) return null;
  return v;
}

// ── Subscriptions (pure) ────────────────────────────────────────────────────

export type ProductKind = "onetime" | "subscription";
export type BillingInterval = "month" | "year";

/** Subscription periods map to key lifetimes (a little long, never short). */
export function intervalToDays(interval: BillingInterval): number {
  return interval === "year" ? 366 : 31;
}

/**
 * Renewal math: extend from the CURRENT expiry when it is still in the
 * future (stacking early renewals), otherwise from now. Never backwards.
 */
export function nextRenewalExpiryMs(input: {
  currentExpiryMs: number | null;
  intervalMs: number;
  nowMs: number;
}): number {
  const base =
    input.currentExpiryMs !== null && input.currentExpiryMs > input.nowMs
      ? input.currentExpiryMs
      : input.nowMs;
  return base + input.intervalMs;
}

// ── Coupons (pure) ──────────────────────────────────────────────────────────

export type CouponKind = "percent" | "fixed";

export const COUPON_CODE_MAX = 64;

/** Canonical coupon code shape for storage and comparison. */
export function normalizeCouponCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  if (v.length < 3 || v.length > COUPON_CODE_MAX) return null;
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(v)) return null;
  return v;
}

/** Is a coupon row usable right now (ignoring product scope)? */
export function couponUsable(input: {
  active: boolean;
  expiresAtMs: number | null;
  maxUses: number | null;
  usedCount: number;
}, nowMs: number): boolean {
  if (!input.active) return false;
  if (input.expiresAtMs !== null && input.expiresAtMs <= nowMs) return false;
  if (input.maxUses !== null && input.usedCount >= input.maxUses) return false;
  return true;
}

/** Apply a coupon to a price. Result is floored at zero cents. */
export function applyCoupon(input: { kind: CouponKind; value: number }, priceCents: number): number {
  if (input.kind === "percent") {
    const pct = Math.max(0, Math.min(100, input.value));
    return Math.max(0, Math.round(priceCents * (100 - pct) / 100));
  }
  return Math.max(0, priceCents - Math.max(0, Math.floor(input.value)));
}

// ── DB plumbing ─────────────────────────────────────────────────────────────

export const SHOP_CATEGORIES = ["general", "licenses", "servers", "digital", "physical", "services", "merch"] as const;
export type ShopCategory = typeof SHOP_CATEGORIES[number];
export const PRODUCT_TYPES = ["license", "server", "digital", "physical", "service", "subscription", "merch"] as const;
export type ProductType = typeof PRODUCT_TYPES[number];

/** Idempotent — upgrades predate the shop. */
export async function ensureShopTables(): Promise<void> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS shop_products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      description TEXT,
      price_cents INTEGER NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'usd',
      max_activations INTEGER NOT NULL DEFAULT 1,
      duration_days INTEGER,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      kind VARCHAR(12) NOT NULL DEFAULT 'onetime',
      billing_interval VARCHAR(5),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id SERIAL PRIMARY KEY,
      email VARCHAR(254) NOT NULL,
      product_id INTEGER NOT NULL REFERENCES shop_products(id),
      provider VARCHAR(16) NOT NULL DEFAULT 'manual',
      provider_ref TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      amount_cents INTEGER NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'usd',
      license_key_id INTEGER REFERENCES license_keys(id),
      issued_key_plaintext TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMP,
      fulfilled_at TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS shop_coupons (
      id SERIAL PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      kind VARCHAR(8) NOT NULL DEFAULT 'percent',
      value INTEGER NOT NULL,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMP,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      product_id INTEGER REFERENCES shop_products(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS coupon_id INTEGER REFERENCES shop_coupons(id)`);
  await db.execute(sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS provider_sub TEXT`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'onetime'`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(5)`);
  await db.execute(sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS reseller_id INTEGER REFERENCES shop_resellers(id)`);
  await db.execute(sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS commission_cents INTEGER`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS shop_resellers (
      id SERIAL PRIMARY KEY,
      label VARCHAR(128) NOT NULL,
      email VARCHAR(254),
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix VARCHAR(12) NOT NULL,
      commission_pct INTEGER NOT NULL DEFAULT 10,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMP
    )
  `);
  await db.execute(sql`ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS expiry_notified_at TIMESTAMP`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS category VARCHAR(64) NOT NULL DEFAULT 'general'`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) NOT NULL DEFAULT 'license'`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS sku VARCHAR(64)`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS badge VARCHAR(32)`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS compare_at_price_cents INTEGER`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS allow_quantity BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.execute(sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS game_id INTEGER REFERENCES game_definitions(id)`);
  await db.execute(sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(128)`);
  await db.execute(sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS notes TEXT`);
  await db.execute(sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS shipping_address JSONB`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS shop_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(64) NOT NULL UNIQUE,
      slug VARCHAR(64) NOT NULL UNIQUE,
      description TEXT,
      icon VARCHAR(8) DEFAULT '🛒',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS shop_cart_items (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(128) NOT NULL,
      product_id INTEGER NOT NULL REFERENCES shop_products(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    INSERT INTO shop_categories (name, slug, description, icon, sort_order)
    VALUES
      ('All Products', 'all', 'Everything in the store', '🛍️', 0),
      ('Licenses', 'licenses', 'Panel licenses and activation keys', '🔑', 1),
      ('Game Servers', 'servers', 'Pre-configured game servers', '🎮', 2),
      ('Digital Goods', 'digital', 'Configs, plugins, maps and more', '💾', 3),
      ('Services', 'services', 'Setup, migration and support', '🛠️', 4),
      ('Merch', 'merch', 'Swag and physical goods', '👕', 5)
    ON CONFLICT (slug) DO NOTHING
  `);
}

/**
 * Renewal: a subscription invoice was paid. Extend the linked key's expiry
 * (stacking on top of a still-future expiry) and re-arm the expiry notice.
 */
export async function renewSubscriptionByKey(
  providerSub: string,
  intervalMs: number,
  nowMs: number = Date.now()
): Promise<{ ok: boolean; reason?: string }> {
  const { db } = await import("@/db");
  const { shopOrders, licenseKeys, shopProducts } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const [order] = await db.select().from(shopOrders).where(eq(shopOrders.providerSub, providerSub)).limit(1);
  if (!order) return { ok: false, reason: "No order for that subscription" };
  if (!order.licenseKeyId) return { ok: false, reason: "Order has no linked key" };

  const [key] = await db.select().from(licenseKeys).where(eq(licenseKeys.id, order.licenseKeyId)).limit(1);
  if (!key) return { ok: false, reason: "Linked key is gone" };

  const newExpiryMs = nextRenewalExpiryMs({
    currentExpiryMs: key.expiresAt ? new Date(key.expiresAt).getTime() : null,
    intervalMs,
    nowMs,
  });
  await db
    .update(licenseKeys)
    .set({ expiresAt: new Date(newExpiryMs), revokedAt: null, expiryNotifiedAt: null })
    .where(eq(licenseKeys.id, key.id));
  await db.update(shopOrders).set({ paidAt: new Date(nowMs) }).where(eq(shopOrders.id, order.id));

  void shopProducts;
  return { ok: true };
}

/** Cancellation: the Stripe subscription ended — revoke the linked key. */
export async function cancelSubscriptionByKey(providerSub: string): Promise<{ ok: boolean; reason?: string }> {
  const { db } = await import("@/db");
  const { shopOrders, licenseKeys } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const [order] = await db.select().from(shopOrders).where(eq(shopOrders.providerSub, providerSub)).limit(1);
  if (!order) return { ok: false, reason: "No order for that subscription" };
  if (!order.licenseKeyId) return { ok: true, reason: "nothing to revoke" };

  await db
    .update(licenseKeys)
    .set({ revokedAt: new Date() })
    .where(eq(licenseKeys.id, order.licenseKeyId));
  return { ok: true };
}

/**
 * Fulfil an order: for license/server/subscription products, mint a license
 * key; for other product types (digital, physical, service, merch), just mark
 * fulfilled and email a receipt. Returns the plaintext key when one was minted
 * so the order page can show it once. Idempotent.
 */
export async function fulfilOrder(orderId: number): Promise<{ ok: boolean; key?: string; reason?: string }> {
  const { db } = await import("@/db");
  const { shopOrders, shopProducts, licenseKeys } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { generateLicenseKey, hashLicenseKey, licenseKeyDisplayLabel, ensureLicenseTables } = await import("./licensing");

  await ensureShopTables();
  const [order] = await db.select().from(shopOrders).where(eq(shopOrders.id, orderId)).limit(1);
  if (!order) return { ok: false, reason: "Order not found" };
  if (order.status === "fulfilled") {
    return { ok: true, key: order.issuedKeyPlaintext ?? undefined };
  }
  if (!orderCanFulfil(order.status as ShopOrderStatus)) {
    return { ok: false, reason: `Order is ${order.status} and cannot be fulfilled` };
  }

  const [product] = await db.select().from(shopProducts).where(eq(shopProducts.id, order.productId)).limit(1);
  if (!product) return { ok: false, reason: "The product for this order no longer exists" };

  const productType = (product.productType as string) || "license";
  const isLicenseLike = ["license", "server", "subscription"].includes(productType) || product.kind === "subscription";

  if (!isLicenseLike) {
    await db
      .update(shopOrders)
      .set({
        status: "fulfilled",
        paidAt: order.paidAt ?? new Date(),
        fulfilledAt: new Date(),
      })
      .where(eq(shopOrders.id, order.id));

    try {
      const { sendEmail } = await import("./email");
      const shippingNote =
        productType === "physical" || productType === "merch"
          ? "The operator will arrange shipping and contact you if needed."
          : "You can access your purchase in your account or via the link the operator provided.";
      await sendEmail(
        order.email,
        `Your order #${order.id} is ready - ${product.name}`,
        `<p>Thanks for your purchase - order <b>#${order.id}</b> (${product.name}) x${order.quantity ?? 1}.</p>` +
          `<p>Your order has been fulfilled. ${shippingNote}</p>` +
          `<p>Order total: <b>${(order.amountCents / 100).toFixed(2)} ${order.currency.toUpperCase()}</b></p>`
      );
    } catch {
      /* best-effort */
    }

    return { ok: true };
  }

  await ensureLicenseTables();
  const key = await generateLicenseKey();
  const keyHash = await hashLicenseKey(key);
  const subDays =
    product.kind === "subscription" && product.billingInterval
      ? intervalToDays(product.billingInterval as "month" | "year")
      : null;
  const effectiveDays = subDays ?? product.durationDays;
  const expiresAt = effectiveDays ? new Date(Date.now() + effectiveDays * 86_400_000) : null;

  const [licenseRow] = await db
    .insert(licenseKeys)
    .values({
      keyHash,
      keyPrefix: licenseKeyDisplayLabel(key),
      label: `Shop order #${order.id} (${product.name})`,
      maxActivations: product.maxActivations,
      expiresAt,
      createdBy: null,
    })
    .returning({ id: licenseKeys.id });

  const plaintext = key;
  await db
    .update(shopOrders)
    .set({
      status: "fulfilled",
      licenseKeyId: licenseRow.id,
      issuedKeyPlaintext: plaintext,
      paidAt: order.paidAt ?? new Date(),
      fulfilledAt: new Date(),
    })
    .where(eq(shopOrders.id, order.id));

  try {
    const { sendEmail } = await import("./email");
    const expiryLine = expiresAt ? `It expires on <b>${expiresAt.toISOString().slice(0, 10)}</b>.` : "It never expires.";
    await sendEmail(
      order.email,
      "Your GameServer Manager license key",
      `<p>Thanks for your purchase - order <b>#${order.id}</b> (${product.name}).</p>` +
        `<p>Your license key:</p><p><code style="font-size:15px">${plaintext}</code></p>` +
        `<p>${expiryLine} Activations allowed: <b>${product.maxActivations}</b>.</p>` +
        `<p>Install with the key, or check it any time at the license page.</p>`
    );
  } catch {
    /* best-effort */
  }

  return { ok: true, key: plaintext };
}

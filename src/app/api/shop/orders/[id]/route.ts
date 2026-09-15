import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopOrders, shopProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shop/orders/[id]?email=... — order status; the key is revealed
// only to the buyer's own email address (exact match, case-insensitive).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Enter the email you used for the purchase to view the order." }, { status: 400 });
    }

    await ensureShopTables();
    const [order] = await db
      .select()
      .from(shopOrders)
      .where(eq(shopOrders.id, Number(id)))
      .limit(1);
    if (!order || order.email.toLowerCase() !== email) {
      // Same answer for "no such order" and "wrong email" — no probing.
      return NextResponse.json({ error: "No order matches that ID and email." }, { status: 404 });
    }

    const [product] = await db
      .select({
        name: shopProducts.name,
        durationDays: shopProducts.durationDays,
        maxActivations: shopProducts.maxActivations,
        productType: shopProducts.productType,
        kind: shopProducts.kind,
        imageUrl: shopProducts.imageUrl,
      })
      .from(shopProducts)
      .where(eq(shopProducts.id, order.productId))
      .limit(1);

    return NextResponse.json({
      orderId: order.id,
      status: order.status,
      product: product?.name ?? null,
      productType: (product as any)?.productType ?? "license",
      kind: (product as any)?.kind ?? "onetime",
      imageUrl: (product as any)?.imageUrl ?? null,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      fulfilledAt: order.fulfilledAt,
      amountCents: order.amountCents,
      currency: order.currency,
      quantity: (order as any).quantity ?? 1,
      customerName: (order as any).customerName ?? null,
      key: order.status === "fulfilled" ? order.issuedKeyPlaintext : null,
      maxActivations: product?.maxActivations ?? null,
      durationDays: product?.durationDays ?? null,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load the order", 500);
  }
}

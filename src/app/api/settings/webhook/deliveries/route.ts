import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recentWebhookDeliveries, formatDeliveryLine } from "@/lib/webhook-delivery-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/settings/webhook/deliveries — recent outbound delivery attempts
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const entries = recentWebhookDeliveries(15);
  return NextResponse.json({
    deliveries: entries.map((e) => ({ ...e, line: formatDeliveryLine(e) })),
  });
}

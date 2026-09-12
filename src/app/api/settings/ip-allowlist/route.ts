import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api-error";
import { IP_ALLOWLIST_KEY, parseAllowList, isLoopback, clientIpFromHeaders } from "@/lib/ip-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return { auth: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as NextResponse };
  if (auth.role !== "admin") return { auth: null, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) as NextResponse };
  return { auth, res: null };
}

async function readAllowlist() {
  const { db } = await import("@/db");
  const { settings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, IP_ALLOWLIST_KEY))
    .limit(1);
  const spec = row?.value ?? "";
  return { spec, rules: parseAllowList(spec) };
}

// GET — current allowlist + the caller's own IP (admin only)
export async function GET(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { spec, rules } = await readAllowlist();
    return NextResponse.json({ spec, rules, yourIp: clientIpFromHeaders(req.headers) });
  } catch (e: unknown) {
    return apiError(e, "Could not load the allowlist", 500);
  }
}

// POST — { spec: string } to save, or { addSelf: true } to append the caller's IP
export async function POST(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  try {
    const { upsertSetting } = await import("@/lib/webhook-dispatch");
    let { spec } = await readAllowlist();

    if (b.addSelf === true) {
      const ip = clientIpFromHeaders(req.headers);
      if (!ip || isLoopback(ip)) {
        return NextResponse.json(
          { error: "Your IP is not forwarded (loopback/unknown) — nothing safe to add." },
          { status: 400 }
        );
      }
      const rules = parseAllowList(spec);
      if (!rules.includes(ip)) spec = [...rules, ip].join(",");
    } else if (typeof b.spec === "string") {
      spec = b.spec;
    } else {
      return NextResponse.json({ error: "Provide spec or addSelf" }, { status: 400 });
    }

    // Reject obviously malformed rules before they become a lockout.
    for (const rule of parseAllowList(spec)) {
      if (!/^[0-9A-Fa-f:.]*\*?$/.test(rule)) {
        return NextResponse.json(
          { error: `Rule "${rule}" is not a valid IP or IP.* pattern` },
          { status: 400 }
        );
      }
    }

    await upsertSetting(IP_ALLOWLIST_KEY, spec.trim() === "" ? null : spec.trim());
    const out = await readAllowlist();
    return NextResponse.json({ spec: out.spec, rules: out.rules, yourIp: clientIpFromHeaders(req.headers) });
  } catch (e: unknown) {
    return apiError(e, "Could not save the allowlist", 500);
  }
}

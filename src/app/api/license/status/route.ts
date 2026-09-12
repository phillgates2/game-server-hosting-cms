import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { currentLicenseState } from "@/lib/license-heartbeat";
import { isLicenseMasterMode, licenseServerUrl } from "@/lib/license-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/license/status — heartbeat state for the banner/login gate
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const state = await currentLicenseState();
    return NextResponse.json({
      master: isLicenseMasterMode(),
      server: licenseServerUrl(),
      state: state.state,
      code: state.code,
      banner: state.banner,
      lastCheckAt: state.lastCheckAt,
    });
  } catch {
    // Diagnostics must never break the dashboard.
    return NextResponse.json({ master: isLicenseMasterMode(), server: licenseServerUrl(), state: "ok", code: null, banner: null, lastCheckAt: null });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getIPv6Status, testIPv6Connectivity } from "@/lib/ipv6";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const status = getIPv6Status();
    const connectivity = testIPv6Connectivity();

    return NextResponse.json({
      status,
      connectivity,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "IPv6 check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

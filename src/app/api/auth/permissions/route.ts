import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserPermissions } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ permissions: {} }, { status: 401 });

  const permissions = await getUserPermissions(auth.userId);
  return NextResponse.json({ permissions });
}

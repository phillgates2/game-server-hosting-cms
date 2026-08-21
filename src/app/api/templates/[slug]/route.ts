import { NextRequest, NextResponse } from "next/server";
import { getTemplateBySlug } from "@/db/seeds";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

// GET /api/templates/[slug] - Get full template details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !((await hasPermission(auth.userId, "games.templates")) || (await hasPermission(auth.userId, "games.view")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { slug } = await params;
  const template = getTemplateBySlug(slug);

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ template });
}

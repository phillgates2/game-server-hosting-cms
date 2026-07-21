import { NextRequest, NextResponse } from "next/server";
import { getTemplateBySlug } from "@/db/seeds";

// GET /api/templates/[slug] - Get full template details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const template = getTemplateBySlug(slug);

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ template });
}

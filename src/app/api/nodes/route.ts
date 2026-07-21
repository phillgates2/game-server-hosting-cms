import { NextResponse } from "next/server";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const allNodes = await db.select().from(nodes);
  return NextResponse.json({ nodes: allNodes });
}

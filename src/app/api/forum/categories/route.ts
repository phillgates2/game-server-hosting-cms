import { NextResponse } from "next/server";
import { db } from "@/db";
import { forumCategories } from "@/db/schema";
import { asc } from "drizzle-orm";

export async function GET() {
  try {
    const categories = await db
      .select()
      .from(forumCategories)
      .orderBy(asc(forumCategories.sortOrder));
    return NextResponse.json({ categories });
  } catch {
    return NextResponse.json({ categories: [] });
  }
}

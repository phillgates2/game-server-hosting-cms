import { NextResponse } from "next/server";
import { db } from "@/db";
import { plans } from "@/db/schema";

export async function GET() {
  try {
    const allPlans = await db.select().from(plans);
    return NextResponse.json({ plans: allPlans });
  } catch {
    return NextResponse.json({ plans: [] });
  }
}

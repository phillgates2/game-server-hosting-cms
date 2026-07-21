import { NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";

export async function GET() {
  const games = await db.select().from(gameDefinitions);
  return NextResponse.json({ games });
}

import { NextResponse } from "next/server";
import { pool } from "@/db";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
  } catch (e: unknown) {
    return NextResponse.json(
      { status: "error", database: "disconnected", error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { pool } from "@/db";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
  } catch (e: unknown) {
    // This endpoint is unauthenticated (the installer and updater poll it), so
    // the driver message - which carries the host, port and sometimes
    // credentials from the connection string - must not be returned.
    console.error("[api] health check failed:", e instanceof Error ? e.stack || e.message : e);
    return NextResponse.json(
      { status: "error", database: "disconnected", timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

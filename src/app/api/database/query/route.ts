import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const { sql } = await req.json();
    if (!sql || typeof sql !== "string") {
      return NextResponse.json({ error: "SQL query required" }, { status: 400 });
    }

    const startTime = Date.now();
    const result = await pool.query(sql);
    const duration = Date.now() - startTime;

    return NextResponse.json({
      rows: result.rows || [],
      rowCount: result.rowCount,
      fields: result.fields?.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) || [],
      command: result.command,
      duration,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

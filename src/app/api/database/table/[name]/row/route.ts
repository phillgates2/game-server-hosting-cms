import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { name: tableName } = await params;

  try {
    const tableCheck = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    if (tableCheck.rows.length === 0) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }

    const body = await req.json();
    const { action, data, where } = body;

    if (action === "insert") {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO "${tableName}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`;
      const result = await pool.query(sql, values);
      return NextResponse.json({ row: result.rows[0] });
    }

    if (action === "update") {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const [key, value] of Object.entries(data)) {
        setClauses.push(`"${key}" = $${idx}`);
        values.push(value);
        idx++;
      }
      const whereClauses: string[] = [];
      for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
        whereClauses.push(`"${key}" = $${idx}`);
        values.push(value);
        idx++;
      }
      const sql = `UPDATE "${tableName}" SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")} RETURNING *`;
      const result = await pool.query(sql, values);
      return NextResponse.json({ row: result.rows[0] });
    }

    if (action === "delete") {
      const values: unknown[] = [];
      const whereClauses: string[] = [];
      let idx = 1;
      for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
        whereClauses.push(`"${key}" = $${idx}`);
        values.push(value);
        idx++;
      }
      const sql = `DELETE FROM "${tableName}" WHERE ${whereClauses.join(" AND ")}`;
      await pool.query(sql, values);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

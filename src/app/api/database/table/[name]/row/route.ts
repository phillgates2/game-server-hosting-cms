import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";

/**
 * Quote a Postgres identifier that has already been checked against the real
 * column list. Doubling embedded quotes is what makes the quoting total rather
 * than merely decorative.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "database.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
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

    // Identifiers cannot be parameterised, so they are matched against the
    // table's actual columns. Anything not on that list is rejected outright —
    // without this, a crafted key escapes the quoted identifier and appends
    // arbitrary SQL.
    const columnsResult = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    const validColumns = new Set<string>(columnsResult.rows.map((r) => r.column_name as string));

    const body = await req.json();
    const { action, data, where } = body;

    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

    const unknownColumn = [
      ...Object.keys(asRecord(data)),
      ...Object.keys(asRecord(where)),
    ].find((key) => !validColumns.has(key));

    if (unknownColumn) {
      return NextResponse.json({ error: `Unknown column: ${unknownColumn}` }, { status: 400 });
    }

    if (action === "insert") {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      if (keys.length === 0) return NextResponse.json({ error: "No data provided" }, { status: 400 });
      const sql = `INSERT INTO ${quoteIdent(tableName)} (${keys.map(quoteIdent).join(", ")}) VALUES (${placeholders}) RETURNING *`;
      const result = await pool.query(sql, values);
      return NextResponse.json({ row: result.rows[0] });
    }

    if (action === "update") {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const [key, value] of Object.entries(data)) {
        setClauses.push(`${quoteIdent(key)} = $${idx}`);
        values.push(value);
        idx++;
      }
      const whereClauses: string[] = [];
      for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
        whereClauses.push(`${quoteIdent(key)} = $${idx}`);
        values.push(value);
        idx++;
      }
      // An unbounded UPDATE would silently rewrite the whole table.
      if (setClauses.length === 0 || whereClauses.length === 0) {
        return NextResponse.json({ error: "Update requires data and a where clause" }, { status: 400 });
      }
      const sql = `UPDATE ${quoteIdent(tableName)} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")} RETURNING *`;
      const result = await pool.query(sql, values);
      return NextResponse.json({ row: result.rows[0] });
    }

    if (action === "delete") {
      const values: unknown[] = [];
      const whereClauses: string[] = [];
      let idx = 1;
      for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
        whereClauses.push(`${quoteIdent(key)} = $${idx}`);
        values.push(value);
        idx++;
      }
      // Same guard for DELETE — no where clause means "delete everything".
      if (whereClauses.length === 0) {
        return NextResponse.json({ error: "Delete requires a where clause" }, { status: 400 });
      }
      const sql = `DELETE FROM ${quoteIdent(tableName)} WHERE ${whereClauses.join(" AND ")}`;
      await pool.query(sql, values);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: unknown) {
    return apiError(e, "Database operation failed");
  }
}

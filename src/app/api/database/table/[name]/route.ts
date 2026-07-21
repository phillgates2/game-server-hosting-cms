import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { name: tableName } = await params;
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  try {
    // Validate table name to prevent injection
    const tableCheck = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    if (tableCheck.rows.length === 0) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }

    const columnsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [tableName]);

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
    const totalRows = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM "${tableName}" ORDER BY 1 LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return NextResponse.json({
      table: tableName,
      columns: columnsResult.rows,
      rows: dataResult.rows,
      totalRows,
      page,
      limit,
      totalPages: Math.ceil(totalRows / limit),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

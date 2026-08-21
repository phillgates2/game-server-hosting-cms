import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  const allowed = auth && ((await hasPermission(auth.userId, "database.view")) || (await hasPermission(auth.userId, "database.view.schema")));
  if (!allowed) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    // Get all tables
    const tablesResult = await pool.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = [];
    for (const row of tablesResult.rows) {
      const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM "${row.table_name}"`
      );
      const columnsResult = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [row.table_name]);

      tables.push({
        name: row.table_name,
        type: row.table_type,
        rowCount: parseInt(countResult.rows[0].count),
        columns: columnsResult.rows,
      });
    }

    return NextResponse.json({ tables });
  } catch (e: unknown) {
    return apiError(e, "Unknown error", 500);
  }
}

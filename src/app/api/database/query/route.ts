import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import {
  assertSingleStatement,
  SQL_STATEMENT_TIMEOUT_MS,
} from "@/lib/sql-guard";

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "database.query"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { sql } = await req.json();
    if (typeof sql !== "string") {
      return NextResponse.json({ error: "SQL query required" }, { status: 400 });
    }

    // One statement, bounded size. The console is deliberately left able to
    // run DML/DDL — that is its purpose — but a second statement is not
    // something anyone typed on purpose.
    const guard = assertSingleStatement(sql);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: 400 });
    }

    // A dedicated client with a statement timeout: `SELECT pg_sleep(3600)`
    // must time out instead of pinning this request and its pooled
    // connection. The connection is discarded afterwards (never reused), so
    // the timeout can never leak onto another request.
    const client = await pool.connect();
    const startTime = Date.now();
    try {
      await client.query(`SET statement_timeout = ${SQL_STATEMENT_TIMEOUT_MS}`);
      const result = await client.query(sql);
      const duration = Date.now() - startTime;

      return NextResponse.json({
        rows: result.rows || [],
        rowCount: result.rowCount,
        fields: result.fields?.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) || [],
        command: result.command,
        duration,
      });
    } finally {
      client.release(true); // destroy: statement_timeout must not persist
    }
  } catch (e: unknown) {
    return apiError(e, "Unknown error", 400);
  }
}

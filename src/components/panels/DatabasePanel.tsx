"use client";

import { useEffect, useState, useCallback } from "react";

interface TableInfo {
  name: string;
  type: string;
  rowCount: number;
  columns: ColumnInfo[];
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

interface TableData {
  table: string;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: { name: string; dataTypeID: number }[];
  command: string;
  duration: number;
  error?: string;
}

type DBView = "tables" | "browse" | "query" | "structure";

export default function DatabasePanel() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [view, setView] = useState<DBView>("tables");
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [page, setPage] = useState(1);
  const [sql, setSql] = useState("SELECT * FROM users LIMIT 10;");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState("");
  const [running, setRunning] = useState(false);
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  const loadTables = useCallback(async () => {
    try {
      const res = await fetch("/api/database");
      const d = await res.json();
      setTables(d.tables || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  const browseTable = useCallback(async (tableName: string, p: number = 1) => {
    setSelectedTable(tableName);
    setView("browse");
    setPage(p);
    try {
      const res = await fetch(`/api/database/table/${tableName}?page=${p}&limit=50`);
      const d = await res.json();
      setTableData(d);
    } catch {
      // ignore
    }
  }, []);

  function viewStructure(tableName: string) {
    setSelectedTable(tableName);
    setView("structure");
  }

  async function runQuery() {
    setRunning(true);
    setQueryError("");
    setQueryResult(null);
    try {
      const res = await fetch("/api/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const d = await res.json();
      if (d.error) {
        setQueryError(d.error);
      } else {
        setQueryResult(d);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Query failed";
      setQueryError(msg);
    } finally {
      setRunning(false);
    }
  }

  async function deleteRow(tableName: string, row: Record<string, unknown>) {
    if (!confirm("Delete this row?")) return;
    const where: Record<string, unknown> = {};
    // Use first column as identifier (usually 'id')
    const keys = Object.keys(row);
    if (keys.includes("id")) {
      where["id"] = row["id"];
    } else {
      where[keys[0]] = row[keys[0]];
    }

    await fetch(`/api/database/table/${tableName}/row`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", where }),
    });
    browseTable(tableName, page);
  }

  function startEdit(row: Record<string, unknown>) {
    setEditRow(row);
    const form: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      form[k] = v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    setEditForm(form);
  }

  async function saveEdit() {
    if (!editRow || !selectedTable) return;
    const where: Record<string, unknown> = {};
    if ("id" in editRow) {
      where["id"] = editRow["id"];
    } else {
      const keys = Object.keys(editRow);
      where[keys[0]] = editRow[keys[0]];
    }

    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editForm)) {
      if (k === "id") continue;
      data[k] = v === "" ? null : v;
    }

    await fetch(`/api/database/table/${selectedTable}/row`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", data, where }),
    });
    setEditRow(null);
    browseTable(selectedTable, page);
  }

  const currentTableInfo = tables.find((t) => t.name === selectedTable);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🗄️ Database Manager</h2>
          <p className="text-text-secondary text-sm">PostgreSQL database viewer, editor & query tool</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView("tables")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              view === "tables" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"
            }`}
          >
            Tables
          </button>
          <button
            onClick={() => setView("query")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              view === "query" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"
            }`}
          >
            SQL Query
          </button>
        </div>
      </div>

      {/* Tables list */}
      {view === "tables" && (
        <div className="grid gap-3">
          {tables.map((table) => (
            <div key={table.name} className="bg-bg-card border border-border rounded-xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium font-mono text-sm">{table.name}</h3>
                <p className="text-xs text-text-muted">{table.rowCount} rows · {table.columns.length} columns</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => browseTable(table.name)}
                  className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs font-medium hover:bg-accent/25 transition-colors"
                >
                  Browse
                </button>
                <button
                  onClick={() => viewStructure(table.name)}
                  className="px-3 py-1.5 bg-bg-secondary text-text-muted rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors"
                >
                  Structure
                </button>
                <button
                  onClick={() => { setSql(`SELECT * FROM "${table.name}" LIMIT 50;`); setView("query"); }}
                  className="px-3 py-1.5 bg-purple/15 text-purple rounded-lg text-xs font-medium hover:bg-purple/25 transition-colors"
                >
                  Query
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Browse table */}
      {view === "browse" && tableData && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold font-mono">{tableData.table} <span className="text-text-muted font-normal">({tableData.totalRows} rows)</span></h3>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => browseTable(selectedTable, page - 1)}
                className="px-3 py-1 bg-bg-secondary rounded text-xs disabled:opacity-30"
              >
                ← Prev
              </button>
              <span className="px-3 py-1 bg-bg-secondary rounded text-xs">
                Page {tableData.page} / {tableData.totalPages}
              </span>
              <button
                disabled={page >= tableData.totalPages}
                onClick={() => browseTable(selectedTable, page + 1)}
                className="px-3 py-1 bg-bg-secondary rounded text-xs disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>

          <div className="overflow-x-auto bg-bg-card border border-border rounded-xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {tableData.columns.map((col) => (
                    <th key={col.column_name} className="px-3 py-2 text-left text-text-muted font-medium whitespace-nowrap">
                      {col.column_name}
                      <span className="text-[10px] text-text-muted block font-normal">{col.data_type}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left text-text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tableData.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-bg-hover">
                    {tableData.columns.map((col) => (
                      <td key={col.column_name} className="px-3 py-2 max-w-[200px] truncate">
                        {editRow && editRow["id"] === row["id"] ? (
                          <input
                            value={editForm[col.column_name] || ""}
                            onChange={(e) => setEditForm({ ...editForm, [col.column_name]: e.target.value })}
                            className="w-full px-1 py-0.5 bg-bg-secondary border border-border rounded text-xs"
                            disabled={col.column_name === "id"}
                          />
                        ) : (
                          <span title={String(row[col.column_name] ?? "NULL")}>
                            {row[col.column_name] === null ? (
                              <span className="text-text-muted italic">NULL</span>
                            ) : typeof row[col.column_name] === "object" ? (
                              JSON.stringify(row[col.column_name])
                            ) : (
                              String(row[col.column_name])
                            )}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {editRow && editRow["id"] === row["id"] ? (
                        <div className="flex gap-1">
                          <button onClick={saveEdit} className="px-2 py-0.5 bg-success/15 text-success rounded text-[10px]">Save</button>
                          <button onClick={() => setEditRow(null)} className="px-2 py-0.5 bg-bg-secondary text-text-muted rounded text-[10px]">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={() => startEdit(row)} className="px-2 py-0.5 bg-accent/15 text-accent rounded text-[10px]">Edit</button>
                          <button onClick={() => deleteRow(selectedTable, row)} className="px-2 py-0.5 bg-danger/15 text-danger rounded text-[10px]">Del</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Structure view */}
      {view === "structure" && currentTableInfo && (
        <div className="space-y-4">
          <h3 className="font-semibold font-mono">{selectedTable} — Structure</h3>
          <div className="overflow-x-auto bg-bg-card border border-border rounded-xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Column</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Type</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Nullable</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Default</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Max Length</th>
                </tr>
              </thead>
              <tbody>
                {currentTableInfo.columns.map((col) => (
                  <tr key={col.column_name} className="border-b border-border/50">
                    <td className="px-4 py-2 font-mono font-medium">{col.column_name}</td>
                    <td className="px-4 py-2 text-accent">{col.data_type}</td>
                    <td className="px-4 py-2">
                      <span className={col.is_nullable === "YES" ? "text-warning" : "text-success"}>
                        {col.is_nullable}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-text-muted font-mono">{col.column_default || "—"}</td>
                    <td className="px-4 py-2 text-text-muted">{col.character_maximum_length || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SQL Query */}
      {view === "query" && (
        <div className="space-y-4">
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">SQL Query Editor</h3>
              <button
                onClick={runQuery}
                disabled={running}
                className="px-4 py-1.5 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
              >
                {running ? "Running..." : "▶ Execute"}
              </button>
            </div>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={5}
              className="w-full px-4 py-3 bg-bg-primary border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent resize-y"
              placeholder="Enter SQL query..."
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  runQuery();
                }
              }}
            />
            <p className="text-[10px] text-text-muted mt-1">Press Ctrl+Enter to execute</p>
          </div>

          {queryError && (
            <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-danger text-sm font-mono">
              {queryError}
            </div>
          )}

          {queryResult && (
            <div className="space-y-2">
              <div className="flex gap-4 text-xs text-text-muted">
                <span>Command: {queryResult.command}</span>
                <span>Rows: {queryResult.rowCount}</span>
                <span>Duration: {queryResult.duration}ms</span>
              </div>
              {queryResult.rows.length > 0 && (
                <div className="overflow-x-auto bg-bg-card border border-border rounded-xl">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {queryResult.fields.map((f) => (
                          <th key={f.name} className="px-3 py-2 text-left text-text-muted font-medium whitespace-nowrap">
                            {f.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.rows.map((row, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-bg-hover">
                          {queryResult.fields.map((f) => (
                            <td key={f.name} className="px-3 py-2 max-w-[300px] truncate">
                              {row[f.name] === null ? (
                                <span className="text-text-muted italic">NULL</span>
                              ) : typeof row[f.name] === "object" ? (
                                JSON.stringify(row[f.name])
                              ) : (
                                String(row[f.name])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

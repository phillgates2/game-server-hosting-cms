"use client";

import { useEffect, useState } from "react";

interface DbTableInfo {
  name: string;
  kind: "table" | "view";
  rows: number | null;
  sql: string | null;
}

interface DbColumnInfo {
  name: string;
  type: string;
}

type DbCell =
  | string
  | number
  | boolean
  | null
  | { $blob: true; bytes: number; truncated: boolean; preview: string };

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fmtCount(n: number | null): string {
  if (n === null) return "?";
  return n.toLocaleString();
}

const PAGE_SIZE = 100;

function isBlobCell(cell: DbCell): cell is { $blob: true; bytes: number; truncated: boolean; preview: string } {
  return typeof cell === "object" && cell !== null && "$blob" in cell;
}

function Cell({ value }: { value: DbCell }) {
  if (value === null) {
    return <span className="italic text-text-muted/70">NULL</span>;
  }
  if (isBlobCell(value)) {
    return (
      <span
        className="inline-block px-1.5 py-0.5 bg-accent/10 text-accent rounded text-[11px] whitespace-nowrap"
        title={value.truncated ? `Binary data, first ${value.bytes} bytes shown truncated` : "Binary data"}
      >
        ⬢ blob · {fmtSize(value.bytes)}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-sky-300">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-amber-300">{value ? "TRUE" : "FALSE"}</span>;
  }
  const text = String(value);
  if (text.length > 200) {
    return (
      <span title={text} className="cursor-help">
        {text.slice(0, 200)}…
      </span>
    );
  }
  return <span className="whitespace-pre-wrap break-all">{text}</span>;
}

export default function DbBrowser({
  serverId,
  path,
  name,
  size,
  onBack,
  onDownload,
}: {
  serverId: number;
  path: string;
  name: string;
  size: number;
  onBack: () => void;
  onDownload: () => void;
}) {
  const [tables, setTables] = useState<DbTableInfo[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [columns, setColumns] = useState<DbColumnInfo[]>([]);
  const [rows, setRows] = useState<DbCell[][]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/servers/${serverId}/db?path=${encodeURIComponent(path)}`;

  async function loadPage(table: string, pageNum: number) {
    if (!table) return;
    setLoadingRows(true);
    setError(null);
    try {
      const res = await fetch(
        `${base}&action=rows&table=${encodeURIComponent(table)}&limit=${PAGE_SIZE}&offset=${pageNum * PAGE_SIZE}`
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Failed to read table (HTTP ${res.status})`);
      setColumns(d.columns || []);
      setRows(d.rows || []);
      setTotal(typeof d.total === "number" ? d.total : null);
      setPage(pageNum);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read table");
    } finally {
      setLoadingRows(false);
    }
  }

  // Table list loads once per file (the parent remounts this component per
  // database via `key`, so the initial useState values are the reset).
  useEffect(() => {
    let cancelled = false;
    fetch(`${base}&action=tables`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `Failed to open database (HTTP ${r.status})`);
        return d;
      })
      .then((d: { tables?: DbTableInfo[] }) => {
        if (cancelled) return;
        const list = d.tables || [];
        setTables(list);
        if (list.length > 0) {
          setSelected(list[0].name);
          void loadPage(list[0].name, 0);
        }
        setLoadingTables(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to open database");
        setLoadingTables(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, path]);

  function pickTable(name: string) {
    setShowSchema(false);
    setSelected(name);
    void loadPage(name, 0);
  }

  const selectedInfo = tables?.find((t) => t.name === selected) || null;
  const pageCount = total !== null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="text-accent text-sm hover:underline shrink-0">
            ← Back
          </button>
          <span className="text-lg">🗄️</span>
          <span className="text-sm font-mono text-text-muted truncate">{path}</span>
          <span className="text-xs text-text-muted shrink-0">({fmtSize(size)})</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success shrink-0" title="The database is opened read-only — browsing cannot modify it">
            read-only
          </span>
        </div>
        <button onClick={onDownload} className="px-3 py-1.5 bg-bg-secondary text-text-muted rounded-lg text-xs">
          ⬇️ Download
        </button>
      </div>

      {error && (
        <div className="gaming-surface rounded-xl p-8 text-center">
          <span className="text-3xl block mb-2">🗄️</span>
          <p className="text-text-secondary">{error}</p>
          <p className="text-text-muted text-xs mt-2">
            Browsing failed. You can still download this file. A .db extension alone does not guarantee SQLite format.
          </p>
          <div className="mt-3 flex gap-2 justify-center">
            <button onClick={onBack} className="px-4 py-2 bg-bg-secondary text-text-muted rounded-lg text-sm">
              Back to files
            </button>
            <button onClick={onDownload} className="px-4 py-2 bg-accent text-white rounded-lg text-sm">
              Download File
            </button>
          </div>
        </div>
      )}

      {!error && loadingTables && (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm mt-2">Opening database…</p>
        </div>
      )}

      {!error && !loadingTables && tables && tables.length === 0 && (
        <div className="gaming-surface rounded-xl p-8 text-center">
          <span className="text-3xl block mb-2">🗄️</span>
          <p className="text-text-secondary">This database contains no tables or views.</p>
        </div>
      )}

      {!error && !loadingTables && tables && tables.length > 0 && (
        <>
          {/* Table picker */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selected}
              onChange={(e) => pickTable(e.target.value)}
              className="px-3 py-2 gaming-chip rounded-lg text-sm min-w-[220px] max-w-full"
            >
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.kind === "view" ? "👁️" : "📋"} {t.name} ({fmtCount(t.rows)} rows)
                </option>
              ))}
            </select>
            {selectedInfo?.sql && (
              <button
                onClick={() => setShowSchema((v) => !v)}
                className="px-3 py-1.5 gaming-chip rounded-lg text-xs"
              >
                {showSchema ? "▾ Hide schema" : "▸ Schema"}
              </button>
            )}
            <span className="text-xs text-text-muted ml-auto">
              {tables.length} {tables.length === 1 ? "table" : "tables"} ·{" "}
              {selectedInfo ? `${fmtCount(selectedInfo.rows)} rows in ${selectedInfo.kind} "${selected}"` : ""}
            </span>
          </div>

          {showSchema && selectedInfo?.sql && (
            <pre className="px-4 py-3 bg-[#0d1117] border border-border rounded-xl text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap">
              {selectedInfo.sql}
            </pre>
          )}

          {/* Rows grid */}
          <div className="gaming-surface rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-xs font-mono">
                <thead className="sticky top-0 bg-bg-card">
                  <tr className="border-b border-border text-left text-text-muted">
                    <th className="px-3 py-2 font-medium w-12 text-right select-none">#</th>
                    {columns.map((c) => (
                      <th key={c.name} className="px-3 py-2 font-medium whitespace-nowrap" title={c.type || undefined}>
                        {c.name}
                        {c.type && <span className="text-text-muted/60 font-normal"> : {c.type}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingRows && rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-4 py-12 text-center">
                        <div className="inline-block w-6 h-6 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-text-muted">
                        Empty table
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => (
                      <tr key={`${page}-${i}`} className="border-b border-border/30 hover:bg-bg-hover">
                        <td className="px-3 py-1.5 text-right text-text-muted/70 select-none">
                          {page * PAGE_SIZE + i + 1}
                        </td>
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-1.5 align-top max-w-[420px]">
                            <Cell value={cell} />
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pager */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs">
              <span className="text-text-muted">
                {total !== null ? (
                  <>
                    Showing {rows.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} of{" "}
                    {fmtCount(total)}
                  </>
                ) : (
                  <>Showing {rows.length} rows</>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => selected && loadPage(selected, page - 1)}
                  disabled={page === 0 || loadingRows}
                  className="px-3 py-1 gaming-chip rounded-lg disabled:opacity-30"
                >
                  ← Prev
                </button>
                <span className="text-text-muted">
                  Page {page + 1}
                  {pageCount !== null ? ` of ${pageCount}` : ""}
                </span>
                <button
                  onClick={() => selected && loadPage(selected, page + 1)}
                  disabled={loadingRows || (total !== null && (page + 1) * PAGE_SIZE >= total) || (total === null && rows.length < PAGE_SIZE)}
                  className="px-3 py-1 gaming-chip rounded-lg disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

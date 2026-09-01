/**
 * Minimal read-only SQLite table reader.
 *
 * The ET stat mods keep their data in a `user.sqlite` produced by SQLite
 * itself. This module reads the few tables it needs by walking the on-disk
 * b-trees — nothing is executed, no native code, no 24 MB wasm runtime, and
 * the reader is small enough that Turbopack's server build stays lean on
 * memory-constrained hosts.
 *
 * Supported subset (all the stat mod uses): SQLite 3 format, rowid table
 * b-trees (leaf and interior), serial-type records, integer + text values,
 * and overflow chains for large cells. WAL files, freelists and schema
 * changes are not relevant to a read-only one-shot lookup.
 */

const PAGE_HEADER_SIZE = 100;

export interface SqliteRow {
  [column: string]: string | number | null;
}

interface Cursor {
  bytes: Uint8Array;
  pageSize: number;
  reserved: number;
  cache: Map<number, number>;
}

function pageStart(cursor: Cursor, pageNo: number): number {
  let start = cursor.cache.get(pageNo);
  if (start === undefined) {
    start = (pageNo - 1) * cursor.pageSize;
    cursor.cache.set(pageNo, start);
  }
  return start;
}

/**
 * Offset of the b-tree page header. Every page after page 1 begins its
 * b-tree header at the page start; page 1 shares its space with the 100-byte
 * SQLite file header.
 */
function pageHeaderOffset(cursor: Cursor, pageNo: number): number {
  return pageNo === 1 ? PAGE_HEADER_SIZE : 0;
}

function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function u32be(b: Uint8Array, o: number): number {
  return b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

/**
 * SQLite varint: big-endian, 7 bits per byte, the first byte carrying the
 * most significant group.
 */
function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let i = offset;
  for (let count = 0; count < 9; count++) {
    const b = bytes[i] ?? 0;
    value = value * 128 + (b & 0x7f);
    i++;
    if ((b & 0x80) === 0) break;
  }
  return { value, next: i };
}

/** Signed big-endian integer of n bytes, sign-extended. */
function readInt(bytes: Uint8Array, offset: number, n: number): number {
  let value = 0;
  for (let i = 0; i < n; i++) value = value * 256 + (bytes[offset + i] ?? 0);
  if (n < 8 && (bytes[offset] & 0x80) !== 0) {
    value -= Math.pow(2, n * 8);
  }
  return value;
}

/** Decode one record (a row) starting at `start` inside `bytes`. */
function decodeRecord(bytes: Uint8Array, start: number, end: number): (string | number | null)[] {
  const { value: headerLen, next: headerEnd } = readVarint(bytes, start);
  const headerByteEnd = start + headerLen;
  if (headerByteEnd > end) return [];

  const serialTypes: number[] = [];
  let pos = headerEnd;
  while (pos < headerByteEnd) {
    const v = readVarint(bytes, pos);
    serialTypes.push(v.value);
    pos = v.next;
  }

  const values: (string | number | null)[] = [];
  let dataPos = headerByteEnd;
  for (const type of serialTypes) {
    if (type === 0) {
      values.push(null);
    } else if (type <= 6) {
      const n = [0, 1, 2, 3, 4, 6, 8][type];
      values.push(readInt(bytes, dataPos, n));
      dataPos += n;
    } else if (type === 7) {
      values.push(0); // float 0.0 — stat mods never store floats here
      dataPos += 8;
    } else if (type === 8 || type === 9) {
      values.push(0);
    } else if (type >= 12) {
      const isText = type % 2 === 1;
      const size = (type - (isText ? 13 : 12)) / 2;
      const raw = bytes.subarray(dataPos, dataPos + size);
      values.push(isText ? new TextDecoder("utf-8", { fatal: false }).decode(raw) : size);
      dataPos += size;
    } else {
      values.push(null); // reserved serial types
    }
    if (dataPos > end) break;
  }
  return values;
}

/**
 * Read the cell payloads of a table b-tree page, recursing into interior
 * pages and reassembling overflow chains.
 */
function walkTablePage(cursor: Cursor, pageNo: number, collect: (payload: Uint8Array) => void): void {
  const base = pageStart(cursor, pageNo);
  const hdr = pageHeaderOffset(cursor, pageNo);
  const bytes = cursor.bytes;
  if (base + hdr + 12 > bytes.length) return;
  const type = bytes[base + hdr];
  const ncell = u16be(bytes, base + hdr + 3);
  const usable = cursor.pageSize - cursor.reserved;

  if (type === 0x0d) {
    // Leaf table page header is 8 bytes; cells are varint(payload)
    // varint(rowid) payload.
    let pos = base + hdr + 8;
    for (let i = 0; i < ncell; i++) {
      const p = u16be(bytes, pos);
      pos += 2;
      const cellBase = base + p;
      const { value: payloadLen, next: plNext } = readVarint(bytes, cellBase);
      const { next: rNext } = readVarint(bytes, plNext);
      const payloadStart = rNext;

      // SQLite's rule: a leaf cell keeps its whole payload on the page when
      // it fits within usable-35 bytes; only larger cells spill, carrying a
      // 4-byte overflow pointer at the end of their local portion.
      const maxLocal = usable - 35;
      if (payloadLen > maxLocal && payloadLen > 0) {
        const inPage = maxLocal;
        const overflowPage = u32be(bytes, payloadStart + inPage);
        const fragments = [bytes.subarray(payloadStart, payloadStart + inPage)];
        let need = payloadLen - inPage;
        let page = overflowPage;
        while (need > 0 && page !== 0 && pageStart(cursor, page) + 4 <= bytes.length) {
          const obase = pageStart(cursor, page);
          const nextPage = u32be(bytes, obase);
          const chunk = bytes.subarray(obase + 4, obase + usable);
          fragments.push(chunk.subarray(0, Math.min(need, chunk.length)));
          need -= chunk.length;
          page = nextPage;
        }
        const total = fragments.reduce((n, f) => n + f.length, 0);
        const combined = new Uint8Array(total);
        let o = 0;
        for (const f of fragments) {
          const take = Math.min(f.length, total - o);
          combined.set(f.subarray(0, take), o);
          o += take;
        }
        collect(combined.subarray(0, payloadLen));
        continue;
      }
      collect(bytes.subarray(payloadStart, payloadStart + payloadLen));
    }
    return;
  }

  if (type === 0x05) {
    // Interior table page header is 12 bytes (incl. the right-most child),
    // followed by u32 child + varint key pairs.
    let pos = base + hdr + 12;
    const rightMost = u32be(bytes, base + hdr + 8);
    for (let i = 0; i < ncell; i++) {
      const child = u32be(bytes, pos);
      pos += 4;
      const v = readVarint(bytes, pos);
      pos = v.next;
      walkTablePage(cursor, child, collect);
    }
    walkTablePage(cursor, rightMost, collect);
    return;
  }
}

/** sqlite_master's root page + column names for the table. */
function findTableInfo(cursor: Cursor, tableName: string): { root: number; columns: string[] } | null {
  let result: { root: number; columns: string[] } | null = null;
  walkTablePage(cursor, 1, (payload) => {
    if (result) return;
    const fields = decodeRecord(payload, 0, payload.length);
    const type = typeof fields[0] === "string" ? fields[0] : "";
    const name = typeof fields[1] === "string" ? fields[1] : "";
    const sql = typeof fields[4] === "string" ? fields[4] : "";
    if (type !== "table" || name !== tableName) return;
    const root = fields[3];
    if (typeof root !== "number") return;

    // Column names come from the CREATE TABLE statement: the token(s)
    // between the opening parenthesis and each top-level comma.
    const open = sql.indexOf("(");
    const close = sql.lastIndexOf(")");
    const columns: string[] = [];
    if (open !== -1 && close > open) {
      const body = sql.slice(open + 1, close);
      let depth = 0;
      let current = "";
      const defs: string[] = [];
      for (const ch of body) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          defs.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
      if (current.trim()) defs.push(current);
      for (const def of defs) {
        const first = def.trim().split(/\s+/)[0].replace(/["`]/g, "");
        if (!first) continue;
        if (/^(primary|unique|constraint|check|foreign|references|not)$/i.test(first)) continue;
        columns.push(first);
      }
    }
    result = { root, columns };
  });
  return result;
}

/**
 * Read every row of a rowid table as objects keyed by column name, in the
 * table's own order. Returns null when the file is not a readable SQLite db
 * or the table does not exist — callers treat that as "no stats available".
 */
export function readSqliteTable(bytes: Uint8Array, tableName: string): SqliteRow[] | null {
  if (bytes.length < PAGE_HEADER_SIZE + 4) return null;
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 15)) !== "SQLite format 3") return null;

  let pageSize = u16be(bytes, 16);
  if (pageSize === 1) pageSize = 65536;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) return null;
  const reserved = bytes[20] ?? 0;
  const cursor: Cursor = { bytes, pageSize, reserved, cache: new Map() };

  const info = findTableInfo(cursor, tableName);
  if (!info) return null;

  const rows: SqliteRow[] = [];
  walkTablePage(cursor, info.root, (payload) => {
    const values = decodeRecord(payload, 0, payload.length);
    const row: SqliteRow = {};
    for (let i = 0; i < info.columns.length; i++) {
      row[info.columns[i]] = i < values.length ? values[i] : null;
    }
    rows.push(row);
  });
  return rows;
}

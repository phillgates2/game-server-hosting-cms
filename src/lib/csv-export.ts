/**
 * Metrics CSV export: wide-format RFC-4180 CSV keyed on ISO timestamps.
 * Pure so the escaping and merge rules are unit-tested.
 */

export interface CsvPoint {
  t: number;
  v: number;
}

export interface CsvSeries {
  /** Column name — escaped before output. */
  name: string;
  points: readonly CsvPoint[];
}

/** RFC 4180: quote fields containing quotes, commas or newlines. */
export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Merge any number of time series into one wide CSV. Missing points leave
 * empty cells rather than shifting rows — spreadsheets stay aligned.
 */
export function seriesToCsv(seriesList: readonly CsvSeries[]): string {
  const times = new Set<number>();
  for (const s of seriesList) {
    for (const p of s.points) times.add(p.t);
  }
  const sorted = [...times].sort((a, b) => a - b);

  const header = ["time", ...seriesList.map((s) => escapeCsvField(s.name))].join(",");
  const lookups = seriesList.map((s) => new Map(s.points.map((p) => [p.t, p.v])));

  const rows = sorted.map((t) => {
    const cells = [new Date(t).toISOString()];
    for (const lookup of lookups) {
      const v = lookup.get(t);
      cells.push(v === undefined ? "" : String(v));
    }
    return cells.join(",");
  });

  return [header, ...rows].join("\r\n") + "\r\n";
}

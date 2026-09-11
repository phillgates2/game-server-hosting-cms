/**
 * Tests for metrics CSV export.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { escapeCsvField, seriesToCsv } from "../src/lib/csv-export";

describe("escapeCsvField", () => {
  test("plain values pass through", () => {
    assert.equal(escapeCsvField("cpu_percent"), "cpu_percent");
    assert.equal(escapeCsvField("12.5"), "12.5");
  });

  test("quotes, commas and newlines are wrapped and doubled", () => {
    assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
    assert.equal(escapeCsvField("a,b"), '"a,b"');
    assert.equal(escapeCsvField("line\nbreak"), '"line\nbreak"');
  });
});

describe("seriesToCsv", () => {
  const t0 = 1_700_000_000_000;

  test("merges aligned series into wide rows", () => {
    const csv = seriesToCsv([
      { name: "cpu", points: [{ t: t0, v: 10 }, { t: t0 + 1000, v: 20 }] },
      { name: "ram", points: [{ t: t0, v: 55 }, { t: t0 + 1000, v: 60 }] },
    ]);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines[0], "time,cpu,ram");
    assert.equal(lines.length, 3);
    assert.ok(lines[1].endsWith(",10,55"));
    assert.ok(lines[2].endsWith(",20,60"));
  });

  test("missing points become empty cells, rows never shift", () => {
    const csv = seriesToCsv([
      { name: "a", points: [{ t: t0, v: 1 }] },
      { name: "b", points: [{ t: t0 + 5000, v: 2 }] },
    ]);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[1].endsWith(",1,"));
    assert.ok(lines[2].endsWith(",,2"));
  });

  test("timestamps sort ascending and ISO-format", () => {
    const csv = seriesToCsv([{ name: "x", points: [{ t: t0 + 2000, v: 3 }, { t: t0, v: 1 }] }]);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines[1].startsWith(new Date(t0).toISOString()), true);
    assert.equal(lines[2].startsWith(new Date(t0 + 2000).toISOString()), true);
  });

  test("empty input yields just the time column header", () => {
    assert.equal(seriesToCsv([]), "time\r\n");
  });

  test("hostile column names are escaped", () => {
    const csv = seriesToCsv([{ name: 'we"ird,col', points: [{ t: t0, v: 1 }] }]);
    assert.ok(csv.startsWith('time,"we""ird,col"'));
  });
});

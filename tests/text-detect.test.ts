/**
 * Deciding which files the editor may open.
 *
 * The editor reads with readFile(path, "utf8") and saves the string back the
 * same way. For anything that is not valid UTF-8 that round trip is lossy:
 * undecodable bytes become U+FFFD and saving writes the replacements over the
 * original. Verified: the 8 bytes 00 01 ff fe 42 80 90 41 come back as 16
 * bytes of mojibake, and the original is unrecoverable.
 *
 * The old guard was an extension allowlist in the browser only. It was wrong
 * in both directions - it blocked plain-text formats nobody listed (.gm), and
 * it opened files that are binary despite an allowlisted extension.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeText, isValidUtf8, extensionOf } from "../src/lib/text-detect";

const bytes = (...a: number[]) => new Uint8Array(a);
const text = (s: string) => new TextEncoder().encode(s);

describe("extensionOf", () => {
  test("reads the extension, lowercased", () => {
    assert.equal(extensionOf("server.CFG"), "cfg");
    assert.equal(extensionOf("weapons.gm"), "gm");
    assert.equal(extensionOf("a/b/c/server.properties"), "properties");
  });

  test("treats a dotfile as its own name, not an extension", () => {
    assert.equal(extensionOf(".env"), "env");
    assert.equal(extensionOf(".gitignore"), "gitignore");
  });

  test("returns empty when there is no extension", () => {
    assert.equal(extensionOf("Dockerfile"), "");
    assert.equal(extensionOf("README"), "");
  });

  test("uses the last extension", () => {
    assert.equal(extensionOf("archive.tar.gz"), "gz");
    assert.equal(extensionOf("config.json.disabled"), "disabled");
  });
});

describe("text files open in the editor", () => {
  test("GameMonkey scripts are text", () => {
    // The reason this work started: .gm was in no allowlist.
    const gm = text('global fn = function() {\n  print("hi");\n};\n');
    const check = looksLikeText(gm, "weapons.gm");
    assert.equal(check.isText, true);
    // Assert the *route* too: content sniffing alone would call this
    // "utf8 text", so this pins .gm as an explicitly recognised format and
    // keeps a near-empty or oddly-encoded .gm editable.
    assert.equal(check.reason, "known text extension");
  });

  test("a .gm file stays editable even when nearly empty", () => {
    // Falls to the extension hint, since there are no bytes to sniff.
    assert.equal(looksLikeText(text(""), "weapons.gm").isText, true);
    assert.equal(looksLikeText(text("\n"), "weapons.gm").isText, true);
  });

  test("the usual game config formats are text", () => {
    for (const name of [
      "server.cfg", "server.properties", "config.ini", "settings.json",
      "paper-global.yml", "cluster.ini", "server_cfg.ini", "gamemode.vdf",
    ]) {
      assert.equal(
        looksLikeText(text("key = value\n"), name).isText,
        true,
        `${name} should be editable`
      );
    }
  });

  test("an unknown extension holding plain text is still editable", () => {
    // The allowlist's other failure: refusing to open obvious text.
    const check = looksLikeText(text("plain text\n"), "notes.whatever");
    assert.equal(check.isText, true);
    assert.equal(check.reason, "utf8 text");
  });

  test("no extension at all is fine", () => {
    assert.equal(looksLikeText(text("#!/bin/sh\necho hi\n"), "runserver").isText, true);
  });

  test("accented and non-Latin text is preserved", () => {
    const utf8 = text("name=Café Münster ★ サーバー\n");
    assert.equal(looksLikeText(utf8, "server.properties").isText, true);
    assert.equal(isValidUtf8(utf8), true);
  });

  test("an empty file is editable, so new files can be created", () => {
    const check = looksLikeText(bytes(), "new.cfg");
    assert.equal(check.isText, true);
    assert.equal(check.reason, "empty");
  });

  test("tabs, newlines and CRLF do not count as control characters", () => {
    const crlf = text("a=1\r\nb=2\r\n\tindented\r\n");
    assert.equal(looksLikeText(crlf, "server.cfg").isText, true);
  });
});

describe("binary files are refused", () => {
  test("the exact bytes that corrupt on a utf8 round trip", () => {
    // Buffer.from(readFileSync(f,"utf8"),"utf8") does not equal the original.
    const corrupting = bytes(0x00, 0x01, 0xff, 0xfe, 0x42, 0x80, 0x90, 0x41);
    assert.equal(looksLikeText(corrupting, "mystery.unknown").isText, false);
  });

  test("common binary formats", () => {
    for (const [name, sample] of [
      ["icon.png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
      ["addon.gma", text("GMAD")],
      ["world.bsp", bytes(0x56, 0x42, 0x53, 0x50, 0x00, 0x00, 0x00)],
      ["lib.so", bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00)],
      ["save.db", bytes(0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00)],
    ] as [string, Uint8Array][]) {
      assert.equal(looksLikeText(sample, name).isText, false, `${name} must be refused`);
    }
  });

  test("a binary file wearing a text extension is still refused", () => {
    // The case an allowlist cannot catch: a rotated log that is really gzip.
    const gzip = bytes(0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00);
    const check = looksLikeText(gzip, "server.log");
    assert.equal(check.isText, false);
    assert.equal(check.reason, "contains null bytes");
  });

  test("UTF-16 is refused rather than mangled by the utf8 round trip", () => {
    const utf16le = bytes(0xff, 0xfe, 0x41, 0x00, 0x42, 0x00);
    const check = looksLikeText(utf16le, "config.ini");
    assert.equal(check.isText, false);
    assert.equal(check.reason, "utf-16 without a decoder");
  });

  test("a known-binary extension is refused even if the sample looks textual", () => {
    // Short binaries can be accidentally valid UTF-8; a bad save is forever.
    assert.equal(looksLikeText(text("PK"), "backup.zip").isText, false);
    assert.equal(looksLikeText(text("hello"), "server.dat").isText, false);
  });
});

describe("isValidUtf8 rejects what Node would silently replace", () => {
  test("accepts well-formed sequences of every length", () => {
    assert.equal(isValidUtf8(text("A")), true);
    assert.equal(isValidUtf8(text("é")), true);
    assert.equal(isValidUtf8(text("€")), true);
    assert.equal(isValidUtf8(text("𝄞")), true);
  });

  test("rejects a continuation byte with no lead", () => {
    assert.equal(isValidUtf8(bytes(0x41, 0x80, 0x42)), false);
  });

  test("rejects overlong encodings", () => {
    // 0xc0 0xaf is an overlong "/" - a classic path-traversal smuggle.
    assert.equal(isValidUtf8(bytes(0xc0, 0xaf)), false);
    assert.equal(isValidUtf8(bytes(0xe0, 0x80, 0xaf)), false);
  });

  test("rejects surrogate halves", () => {
    assert.equal(isValidUtf8(bytes(0xed, 0xa0, 0x80)), false);
  });

  test("rejects code points above U+10FFFF", () => {
    assert.equal(isValidUtf8(bytes(0xf5, 0x80, 0x80, 0x80)), false);
    assert.equal(isValidUtf8(bytes(0xff)), false);
  });

  test("tolerates a sequence cut off by the sample boundary", () => {
    // We only sniff the first 8 KB, so the cut is our doing, not a defect.
    const truncated = text("héllo wörld ✓").slice(0, -1);
    assert.equal(isValidUtf8(truncated), true);
  });
});

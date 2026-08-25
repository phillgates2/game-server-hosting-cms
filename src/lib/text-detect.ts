/**
 * Decide whether a file can safely be opened in the text editor.
 *
 * The editor reads with `readFile(path, "utf8")` and saves with
 * `writeFile(path, content, "utf8")`. That round trip is lossy for anything
 * that is not valid UTF-8: every undecodable byte becomes U+FFFD, and saving
 * writes those replacement characters back over the original. An 8-byte
 * binary file comes back as 16 bytes of mojibake, and the original is gone.
 *
 * Extension allowlists alone are the wrong guard in both directions - they
 * block plain-text formats nobody thought to list (.gm, .vdf, .kv), and they
 * happily open a corrupt-on-save file that merely has a listed extension
 * (a .log that is actually gzipped, a .json that is a database).
 *
 * So the extension is only a hint. The real decision is made by sniffing the
 * bytes, which is both safer and more permissive.
 */

/** Extensions that are always text, even if the sniffer is unsure. */
const KNOWN_TEXT_EXTS = new Set([
  // Config and data
  "cfg", "ini", "conf", "config", "properties", "yml", "yaml", "toml",
  "json", "xml", "csv", "tsv", "env", "vdf", "acf", "kv", "gi",
  // Docs and logs
  "txt", "md", "log", "readme", "nfo",
  // Scripts
  "sh", "bash", "zsh", "bat", "cmd", "ps1",
  "lua", "gm", "nut", "py", "pl", "rb", "js", "mjs", "cjs", "ts", "as",
  // Web
  "html", "htm", "css", "scss",
  // Misc
  "sql", "service", "timer", "socket", "desktop", "gitignore", "editorconfig",
]);

/**
 * Extensions that are always binary. Sniffing catches most of these anyway,
 * but short or mostly-ASCII binaries can slip through, and a corrupted save
 * is unrecoverable - so refuse outright.
 */
const KNOWN_BINARY_EXTS = new Set([
  // Archives
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "gma", "pak",
  "vpk", "bsp", "wad", "pk3", "pk4",
  // Executables and libraries
  "exe", "dll", "so", "dylib", "bin", "o", "a", "class", "pyc", "wasm",
  // Media
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svgz", "tga", "dds",
  "mp3", "ogg", "wav", "flac", "mp4", "avi", "mkv", "webm", "mov",
  "ttf", "otf", "woff", "woff2",
  // Data stores
  "db", "sqlite", "sqlite3", "mdb", "dat", "sav", "idx",
]);

/** Byte-order marks that positively identify a text file. */
const BOMS: { bom: number[]; encoding: string }[] = [
  { bom: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bom: [0xff, 0xfe], encoding: "utf-16le" },
  { bom: [0xfe, 0xff], encoding: "utf-16be" },
];

export interface TextCheck {
  /** Safe to open in the editor. */
  isText: boolean;
  /** Why, for the UI to explain a refusal. */
  reason:
    | "empty"
    | "known text extension"
    | "known binary extension"
    | "utf8 text"
    | "contains null bytes"
    | "invalid utf-8"
    | "too many control characters"
    | "utf-16 without a decoder";
}

/** Lowercased extension without the dot; "" when there is none. */
export function extensionOf(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  // A leading dot means a dotfile (".env"), not an extension.
  const withoutLeadingDot = base.startsWith(".") ? base.slice(1) : base;
  if (!withoutLeadingDot.includes(".")) {
    return base.startsWith(".") ? withoutLeadingDot.toLowerCase() : "";
  }
  return withoutLeadingDot.split(".").pop()!.toLowerCase();
}

function startsWithBom(bytes: Uint8Array): string | null {
  for (const { bom, encoding } of BOMS) {
    if (bytes.length >= bom.length && bom.every((b, i) => bytes[i] === b)) {
      return encoding;
    }
  }
  return null;
}

/**
 * Inspect the leading bytes of a file and decide whether the editor can open
 * it without destroying it.
 *
 * `sample` should be the first few KB; the whole file is not needed.
 */
export function looksLikeText(sample: Uint8Array, fileName = ""): TextCheck {
  const ext = extensionOf(fileName);

  // Refuse formats that are never editable, whatever the bytes suggest.
  if (KNOWN_BINARY_EXTS.has(ext)) {
    return { isText: false, reason: "known binary extension" };
  }

  // An empty file is trivially editable - this is how new files start.
  if (sample.length === 0) {
    return { isText: true, reason: "empty" };
  }

  const bom = startsWithBom(sample);
  if (bom === "utf-16le" || bom === "utf-16be") {
    // Readable as text, but the editor's utf8 round trip would mangle it.
    return { isText: false, reason: "utf-16 without a decoder" };
  }

  // A null byte effectively never appears in UTF-8 text and is the single
  // strongest binary signal.
  if (sample.includes(0x00)) {
    return { isText: false, reason: "contains null bytes" };
  }

  if (!isValidUtf8(sample)) {
    return { isText: false, reason: "invalid utf-8" };
  }

  // Valid UTF-8 can still be binary-ish. Control characters other than the
  // ordinary whitespace ones are the giveaway.
  let control = 0;
  for (const byte of sample) {
    const isAllowedWhitespace =
      byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0c;
    if (byte < 0x20 && !isAllowedWhitespace) control++;
    if (byte === 0x7f) control++;
  }
  if (control / sample.length > 0.05) {
    return { isText: false, reason: "too many control characters" };
  }

  if (KNOWN_TEXT_EXTS.has(ext)) {
    return { isText: true, reason: "known text extension" };
  }
  return { isText: true, reason: "utf8 text" };
}

/**
 * Strict UTF-8 validation.
 *
 * Rejects overlong encodings, surrogate halves and out-of-range code points,
 * because Node's utf8 decoder silently replaces all of them with U+FFFD -
 * exactly the corruption we are trying to avoid.
 *
 * A multi-byte sequence cut off by the sample boundary is tolerated: the file
 * is probably fine and the truncation is our own doing.
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];

    if (byte <= 0x7f) {
      i++;
      continue;
    }

    let needed: number;
    let codePoint: number;
    let lowerBound: number;

    if (byte >= 0xc2 && byte <= 0xdf) {
      needed = 1;
      codePoint = byte & 0x1f;
      lowerBound = 0x80;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      needed = 2;
      codePoint = byte & 0x0f;
      lowerBound = 0x800;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      needed = 3;
      codePoint = byte & 0x07;
      lowerBound = 0x10000;
    } else {
      // 0xc0/0xc1 are always overlong; 0xf5+ exceed U+10FFFF; 0x80-0xbf are
      // continuation bytes with no lead.
      return false;
    }

    // A sequence cut off by the sample boundary is our own doing, not a
    // defect in the file - accept it.
    if (i + needed > bytes.length - 1) return true;

    for (let k = 1; k <= needed; k++) {
      const cont = bytes[i + k];
      if ((cont & 0xc0) !== 0x80) return false;
      codePoint = (codePoint << 6) | (cont & 0x3f);
    }

    if (codePoint < lowerBound) return false; // overlong
    if (codePoint > 0x10ffff) return false;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false; // surrogate

    i += needed + 1;
  }
  return true;
}

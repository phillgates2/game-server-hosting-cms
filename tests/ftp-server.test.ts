/**
 * Tests for the built-in FTP/FTPS server.
 *
 * Two layers, because they fail in different ways:
 *
 *   1. The pure protocol helpers — path containment above all. The virtual root
 *      is the only thing standing between an FTP login and `/etc`, and it has
 *      to survive `../../..`, backslash games, NUL bytes and absurd depth.
 *   2. A real server on a real socket, driven by a hand-written FTP client.
 *      That is the only way to catch the bugs that matter in a protocol
 *      implementation: a wrong reply code, a data connection that never
 *      closes, an upload that leaves a half-written file behind, a PORT command
 *      that would dial a third party.
 *
 *   npm test
 */

import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { readFileSync as readFixture } from "node:fs";
import {
  activeTargetAllowed,
  formatEpsvReply,
  formatListLine,
  formatMlsdLine,
  formatPasvReply,
  ftpTimestamp,
  listingPathFromArg,
  nextPassivePort,
  normalizeVirtualPath,
  parseEprtArg,
  parseFtpCommand,
  parsePortArg,
  sanitizeEntryName,
  virtualBaseName,
  virtualDirName,
} from "../src/lib/ftp-protocol";
import { FtpServer, type FtpSession } from "../src/lib/ftp-server";

// ── Pure protocol helpers ───────────────────────────────────────────────────

describe("command parsing", () => {
  test("splits verb and argument, upper-casing the verb only", () => {
    const parsed = parseFtpCommand("stor My File.bin");
    assert.equal(parsed?.command, "STOR");
    assert.equal(parsed?.arg, "My File.bin");
  });

  test("tolerates CRLF and LF endings", () => {
    assert.equal(parseFtpCommand("PWD\r\n")?.command, "PWD");
    assert.equal(parseFtpCommand("PWD\n")?.command, "PWD");
  });

  test("a bare verb has an empty argument", () => {
    assert.deepEqual(parseFtpCommand("PASV"), { command: "PASV", arg: "" });
  });

  test("rejects blank and oversized lines instead of throwing", () => {
    assert.equal(parseFtpCommand(""), null);
    assert.equal(parseFtpCommand("\r\n"), null);
    assert.equal(parseFtpCommand("X".repeat(9000)), null);
  });
});

describe("virtual path normalisation keeps clients inside their root", () => {
  test("absolute and relative paths both resolve", () => {
    assert.equal(normalizeVirtualPath("/", "/survival-12"), "/survival-12");
    assert.equal(normalizeVirtualPath("/survival-12", "world"), "/survival-12/world");
    assert.equal(normalizeVirtualPath("/survival-12/world", ".."), "/survival-12");
    assert.equal(normalizeVirtualPath("/survival-12", "./region/./r.0.0.mca"), "/survival-12/region/r.0.0.mca");
    assert.equal(normalizeVirtualPath("/survival-12/world", "."), "/survival-12/world");
  });

  test("climbing above the root is refused, not clamped", () => {
    assert.equal(normalizeVirtualPath("/", ".."), null);
    assert.equal(normalizeVirtualPath("/", "../etc/passwd"), null);
    assert.equal(normalizeVirtualPath("/survival-12", "../../etc"), null);
    assert.equal(normalizeVirtualPath("/survival-12/plugins", "../../../.."), null);
  });

  test("a bounce that lands back inside is allowed", () => {
    assert.equal(normalizeVirtualPath("/survival-12/x", "../y"), "/survival-12/y");
  });

  test("NUL bytes and absurd depth are refused", () => {
    assert.equal(normalizeVirtualPath("/", "a\0b"), null);
    const deep = Array.from({ length: 200 }, (_, i) => `d${i}`).join("/");
    assert.equal(normalizeVirtualPath("/", deep), null);
  });

  test("backslashes are ordinary characters, not separators", () => {
    // On Linux `..\..\etc` is a filename that cannot exist, so treating it as
    // traversal would be inventing a vulnerability where there is none.
    assert.equal(normalizeVirtualPath("/", "..\\..\\etc"), "/..\\..\\etc");
  });
});

describe("entry names and path helpers", () => {
  test("a created name can never contain a path", () => {
    assert.equal(sanitizeEntryName("config.yml"), "config.yml");
    assert.equal(sanitizeEntryName("  padded.txt  "), "padded.txt");
    assert.equal(sanitizeEntryName("../escape"), null);
    assert.equal(sanitizeEntryName("dir/file"), null);
    assert.equal(sanitizeEntryName("."), null);
    assert.equal(sanitizeEntryName(".."), null);
    assert.equal(sanitizeEntryName(""), null);
    assert.equal(sanitizeEntryName("x".repeat(256)), null);
    assert.equal(sanitizeEntryName("nul\0byte"), null);
  });

  test("basename and dirname work on virtual paths", () => {
    assert.equal(virtualBaseName("/a/b"), "b");
    assert.equal(virtualBaseName("/"), "");
    assert.equal(virtualDirName("/a/b"), "/a");
    assert.equal(virtualDirName("/a"), "/");
    assert.equal(virtualDirName("/"), "/");
  });

  test("LIST option flags are stripped", () => {
    assert.equal(listingPathFromArg("-la"), "");
    assert.equal(listingPathFromArg("-la /world"), "/world");
    assert.equal(listingPathFromArg("/world"), "/world");
    assert.equal(listingPathFromArg(""), "");
  });
});

describe("active-mode (PORT/EPRT) parsing refuses a bounce", () => {
  test("PORT decodes host and port", () => {
    assert.deepEqual(parsePortArg("127,0,0,1,200,10"), { host: "127.0.0.1", port: 200 * 256 + 10 });
  });

  test("malformed PORT are rejected", () => {
    assert.equal(parsePortArg("127,0,0,1,200"), null);
    assert.equal(parsePortArg("127,0,0,999,200,10"), null);
    assert.equal(parsePortArg(""), null);
  });

  test("EPRT decodes any delimiter", () => {
    assert.deepEqual(parseEprtArg("|1|10.0.0.5|4096|"), { host: "10.0.0.5", port: 4096 });
    assert.deepEqual(parseEprtArg("!2!2001:db8::1!2121!"), { host: "2001:db8::1", port: 2121 });
    assert.equal(parseEprtArg("|3|10.0.0.5|4096|"), null);
    assert.equal(parseEprtArg("|1|10.0.0.5|99999|"), null);
  });

  test("only the client's own address may be dialled", () => {
    assert.equal(activeTargetAllowed("203.0.113.5", "203.0.113.5"), true);
    assert.equal(activeTargetAllowed("::ffff:203.0.113.5", "203.0.113.5"), true);
    assert.equal(activeTargetAllowed("203.0.113.5", "10.0.0.1"), false);
    // The classic bounce: ask the server to hit an internal admin port.
    assert.equal(activeTargetAllowed("203.0.113.5", "127.0.0.1"), false);
    assert.equal(activeTargetAllowed("", "203.0.113.5"), false);
  });
});

describe("listing and passive reply rendering", () => {
  const entry = {
    name: "world.dat",
    isDir: false,
    size: 4096,
    mtimeMs: Date.UTC(2024, 0, 2, 3, 4, 5),
    mode: 0o644,
  };

  test("LIST lines carry permissions, size and a parseable date", () => {
    // Recent files show HH:MM the way `ls -l` does; older ones show the year.
    const recent = formatListLine({ ...entry, mtimeMs: Date.now() - 60_000 });
    assert.match(recent, /^-rw-r--r-- 1 0 0\s+4096 \w{3}\s+\d{1,2} \d{2}:\d{2} world\.dat$/);
    const old = formatListLine(entry);
    assert.match(old, /^-rw-r--r-- 1 0 0\s+4096 Jan\s+2 2024 world\.dat$/);
  });

  test("directories render as directories", () => {
    const line = formatListLine({ ...entry, name: "plugins", isDir: true, mode: 0o755 });
    assert.match(line, /^drwxr-xr-x/);
  });

  test("MLSD lines are the facts FEAT advertises", () => {
    assert.equal(
      formatMlsdLine(entry),
      "type=file;size=4096;modify=20240102030405;perm=adfrw; world.dat"
    );
  });

  test("timestamps are UTC and zero-padded", () => {
    assert.equal(ftpTimestamp(Date.UTC(2024, 0, 2, 3, 4, 5)), "20240102030405");
  });

  test("PASV replies encode the port, EPSV passes it through", () => {
    assert.equal(formatPasvReply("192.168.1.10", 50021), "227 Entering Passive Mode (192,168,1,10,195,101).");
    assert.equal(formatEpsvReply(50021), "229 Entering Extended Passive Mode (|||50021|)");
    // A hostname cannot be expressed in PASV at all.
    assert.equal(formatPasvReply("ftp.example.com", 50021), "");
  });

  test("passive ports rotate, skip busy ones, and give up when exhausted", () => {
    const range = { min: 50000, max: 50002 };
    const first = nextPassivePort(0, range, () => true);
    assert.equal(first?.port, 50000);
    const second = nextPassivePort(first!.cursor, range, () => true);
    assert.equal(second?.port, 50001);
    // 50000 is taken by another listener: the allocator must skip it.
    const busy = nextPassivePort(0, range, (p) => p !== 50000);
    assert.equal(busy?.port, 50001);
    assert.equal(nextPassivePort(0, range, () => false), null);
  });
});

// ── A real server on a real socket ──────────────────────────────────────────

/** A minimal FTP client: enough of the protocol to drive the server. */
class TestClient {
  private socket: Socket;
  private buffer = "";
  private isTls = false;
  private pending: Array<(value: { code: number; lines: string[] }) => void> = [];
  private queue: Array<{ code: number; lines: string[] }> = [];

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.ingest(chunk));
  }

  static async connect(port: number, host = "127.0.0.1"): Promise<TestClient> {
    const socket = createConnection({ port, host });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    return new TestClient(socket);
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const lines = this.buffer.split("\r\n");
      if (lines.length < 2) return;
      // A reply is complete when a line starts with "<code><space>".
      let end = -1;
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          end = i;
          break;
        }
      }
      if (end === -1) return;
      const collected = lines.slice(0, end + 1);
      this.buffer = lines.slice(end + 1).join("\r\n");
      const reply = { code: Number.parseInt(collected[end].slice(0, 3), 10), lines: collected };
      const waiter = this.pending.shift();
      if (waiter) waiter(reply);
      else this.queue.push(reply);
    }
  }

  async read(): Promise<{ code: number; lines: string[] }> {
    const queued = this.queue.shift();
    if (queued) return queued;
    return new Promise((resolve) => this.pending.push(resolve));
  }

  async send(command: string): Promise<{ code: number; lines: string[] }> {
    this.socket.write(`${command}\r\n`);
    return this.read();
  }

  /** PASV then connect: returns the data socket. */
  async passive(): Promise<Socket> {
    const reply = await this.send("PASV");
    assert.equal(reply.code, 227, `PASV failed: ${reply.lines.join(" | ")}`);
    const match = reply.lines[reply.lines.length - 1].match(/\(([\d,]+)\)/);
    assert.ok(match, "PASV reply had no address tuple");
    const parts = match![1].split(",").map(Number);
    const port = parts[4] * 256 + parts[5];
    const socket = createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    return socket;
  }

  async login(username: string, password: string): Promise<number> {
    await this.send(`USER ${username}`);
    const reply = await this.send(`PASS ${password}`);
    return reply.code;
  }

  close(): void {
    this.socket.destroy();
  }

  /**
   * Upgrade the control connection with AUTH TLS (explicit FTPS).
   *
   * The data connection is wrapped with the same credentials, which is what a
   * real FTPS client does after PROT P — and what proves the server's TLS
   * handshake plumbing works for both channels.
   */
  async startTls(): Promise<void> {
    const reply = await this.send("AUTH TLS");
    assert.equal(reply.code, 234, reply.lines.join(" | "));
    const secure = await new Promise<TLSSocket>((resolve, reject) => {
      const socket = tlsConnect(
        { socket: this.socket, servername: "localhost", rejectUnauthorized: false },
        () => resolve(socket)
      );
      socket.once("error", reject);
      setTimeout(() => reject(new Error("client TLS handshake timed out")), 10_000).unref();
    });
    this.socket = secure as unknown as Socket;
    secure.setEncoding("utf8");
    secure.on("data", (chunk: string) => this.ingest(chunk));
    this.isTls = true;
  }

  /** PASV + a TLS-wrapped data connection (PROT P). */
  async passiveTls(): Promise<Socket> {
    const reply = await this.send("PASV");
    assert.equal(reply.code, 227, `PASV failed: ${reply.lines.join(" | ")}`);
    const match = reply.lines[reply.lines.length - 1].match(/\(([\d,]+)\)/);
    assert.ok(match, "PASV reply had no address tuple");
    const parts = match![1].split(",").map(Number);
    const plain = createConnection({ port: parts[4] * 256 + parts[5], host: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      plain.once("connect", () => resolve());
      plain.once("error", reject);
    });
    const secure = await new Promise<TLSSocket>((resolve, reject) => {
      const socket = tlsConnect(
        { socket: plain, servername: "localhost", rejectUnauthorized: false },
        () => resolve(socket)
      );
      socket.once("error", reject);
      setTimeout(() => reject(new Error("data TLS handshake timed out")), 10_000).unref();
    });
    return secure as unknown as Socket;
  }
}

let root: string;
let server: FtpServer;
let port: number;
const logins: Array<{ username: string; password: string; ip: string }> = [];

/** The server folder a session is scoped to, plus a nested tree. */
function makeTree(): string {
  const base = mkdtempSync(join(tmpdir(), "gsm-ftp-test-"));
  mkdirSync(join(base, "plugins", "EssentialsX"), { recursive: true });
  writeFileSync(join(base, "server.properties"), "motd=hello\n");
  writeFileSync(join(base, "plugins", "EssentialsX", "config.yml"), "k: v\n");
  return base;
}

before(async () => {
  root = makeTree();
  server = new FtpServer({
    host: "127.0.0.1",
    port: 0,
    passivePortMin: 51000,
    passivePortMax: 51040,
    idleTimeoutMs: 20_000,
    authenticate: async (username, password, context): Promise<FtpSession | null> => {
      logins.push({ username, password, ip: context.ip });
      if (username !== "alice" || password !== "sekret") return null;
      return {
        accountId: 1,
        username: "alice",
        userId: 7,
        folders: [{ name: "survival-12", absPath: root, serverId: 12, label: "Survival" }],
        rootedAtServer: false,
      };
    },
  });
  const bound = await server.start();
  port = bound.port;
});

after(async () => {
  await server.stop();
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  logins.length = 0;
});

/**
 * Live-socket suites carry their own timeout: a reply that never arrives would
 * otherwise leave the promise pending and stall the whole run, which says
 * nothing about what broke.
 */
const LIVE = { timeout: 25_000 };

async function connected(): Promise<TestClient> {
  const client = await TestClient.connect(port);
  const greeting = await client.read();
  assert.equal(greeting.code, 220);
  return client;
}

describe("the FTP control channel", LIVE, () => {
  test("greets, requires a login, and refuses a bad password generically", async () => {
    const client = await connected();
    assert.equal((await client.send("PWD")).code, 530);
    assert.match((await client.send("USER alice")).lines[0], /^331/);
    const bad = await client.send("PASS wrong");
    assert.equal(bad.code, 530);
    // No username oracle: the same message whether or not the account exists.
    const unknown = await connected();
    await unknown.send("USER nobody");
    assert.equal((await unknown.send("PASS whatever")).code, 530);
    client.close();
    unknown.close();
  });

  test("logs in and lists one folder per server", async () => {
    const client = await connected();
    assert.equal(await client.login("alice", "sekret"), 230);
    assert.equal((await client.send("SYST")).code, 215);
    assert.equal((await client.send("PWD")).lines[0], '257 "/" is the current directory.');

    const data = await client.passive();
    const chunks: Buffer[] = [];
    data.on("data", (c: Buffer) => chunks.push(c));
    const started = await client.send("LIST");
    assert.equal(started.code, 150, started.lines.join(" | "));
    await new Promise((resolve) => data.on("close", resolve));
    const listing = Buffer.concat(chunks).toString("utf8");
    assert.match(listing, /survival-12/);
    assert.match((await client.read()).lines.join(" "), /^226/);

    // MLSD is what modern clients use; it must name the folder as a dir.
    const mlsdData = await client.passive();
    const mlsdChunks: Buffer[] = [];
    mlsdData.on("data", (c: Buffer) => mlsdChunks.push(c));
    assert.equal((await client.send("MLSD")).code, 150);
    await new Promise((resolve) => mlsdData.on("close", resolve));
    assert.match(Buffer.concat(mlsdChunks).toString("utf8"), /type=dir;.*survival-12/);
    assert.match((await client.read()).lines.join(" "), /^226/);

    client.close();
  });

  test("advertises its features, including MLSD and UTF8", async () => {
    const client = await connected();
    const reply = await client.send("FEAT");
    const body = reply.lines.join("\n");
    assert.match(body, /MLSD/);
    assert.match(body, /UTF8/);
    // No certificate configured in this test: AUTH TLS must not be advertised.
    assert.doesNotMatch(body, /AUTH TLS/);
    client.close();
  });
});

describe("browsing and transfers", LIVE, () => {
  test("walks into a folder, reads SIZE/MDTM, and downloads a file", async () => {
    const client = await connected();
    await client.login("alice", "sekret");

    assert.equal((await client.send("CWD survival-12")).code, 250);
    assert.equal((await client.send("CWD ..")).code, 250);

    const size = await client.send("SIZE survival-12/server.properties");
    assert.equal(size.code, 213);
    assert.equal(size.lines[0].split(" ")[1], String("motd=hello\n".length));
    assert.equal((await client.send("MDTM survival-12/server.properties")).code, 213);

    assert.equal((await client.send("TYPE I")).code, 200);
    const data = await client.passive();
    const chunks: Buffer[] = [];
    data.on("data", (c: Buffer) => chunks.push(c));
    const opened = await client.send("RETR survival-12/server.properties");
    assert.equal(opened.code, 150);
    await new Promise((resolve) => data.on("close", resolve));
    assert.equal(Buffer.concat(chunks).toString("utf8"), "motd=hello\n");
    assert.match((await client.read()).lines.join(" "), /^226/);
    client.close();
  });

  test("uploads a large file intact, streaming it to disk", async () => {
    const client = await connected();
    await client.login("alice", "sekret");
    await client.send("TYPE I");

    // 8 MB: big enough that accidental whole-file buffering is visible,
    // small enough to keep the suite quick on loopback.
    const payload = Buffer.alloc(8 * 1024 * 1024);
    for (let i = 0; i < payload.length; i += 4096) payload.writeUInt32LE(i, i);

    const data = await client.passive();
    const started = await client.send("STOR survival-12/plugins/big-world.tar.gz");
    assert.equal(started.code, 150);
    await new Promise<void>((resolve, reject) => {
      data.once("error", reject);
      data.end(payload, () => resolve());
    });
    const done = await client.read();
    assert.equal(done.code, 226, done.lines.join(" | "));

    const written = readFileSync(join(root, "plugins", "big-world.tar.gz"));
    assert.equal(written.length, payload.length);
    assert.ok(written.equals(payload), "uploaded bytes must match exactly");
    // The atomic part file must be gone.
    assert.deepEqual(readdirSync(join(root, "plugins")).filter((f) => f.includes(".part")), []);
    client.close();
  });

  test("a reset upload never leaves a file (or a part file) behind", async () => {
    const client = await connected();
    await client.login("alice", "sekret");
    await client.send("TYPE I");

    const data = await client.passive();
    const opened = await client.send("STOR survival-12/plugins/truncated.zip");
    assert.equal(opened.code, 150);
    data.write(Buffer.alloc(1024 * 1024, 7));
    // A dropped Wi-Fi link resets the connection rather than ending it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    data.resetAndDestroy();

    // The server reports the abort and clears its part file...
    const finished = await client.read();
    assert.equal(finished.code, 426, finished.lines.join(" | "));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // ...and the destination was never created in the first place.
    assert.equal(existsSync(join(root, "plugins", "truncated.zip")), false, "partial file must not be visible");
    assert.deepEqual(readdirSync(join(root, "plugins")).filter((f) => f.endsWith(".part")), []);
    client.close();
  });

  test("creates, renames and deletes entries", async () => {
    const client = await connected();
    await client.login("alice", "sekret");
    await client.send("TYPE I");

    assert.equal((await client.send("MKD survival-12/maps")).code, 257);
    assert.ok(existsSync(join(root, "maps")));

    const upload = await client.passive();
    const started = await client.send("STOR survival-12/maps/rotation.cfg");
    assert.equal(started.code, 150);
    await new Promise<void>((resolve) => upload.end("map1\nmap2\n", resolve));
    assert.equal((await client.read()).code, 226);
    assert.equal(readFileSync(join(root, "maps", "rotation.cfg"), "utf8"), "map1\nmap2\n");

    // APPE appends in place rather than replacing (that is what it is for).
    const append = await client.passive();
    await client.send("APPE survival-12/maps/rotation.cfg");
    await new Promise<void>((resolve) => append.end("map3\n", resolve));
    assert.equal((await client.read()).code, 226);
    assert.equal(readFileSync(join(root, "maps", "rotation.cfg"), "utf8"), "map1\nmap2\nmap3\n");

    assert.equal((await client.send("RNFR survival-12/maps/rotation.cfg")).code, 350);
    assert.equal((await client.send("RNTO survival-12/maps/rotation.conf")).code, 250);
    assert.ok(existsSync(join(root, "maps", "rotation.conf")));
    assert.equal(existsSync(join(root, "maps", "rotation.cfg")), false);

    // Renaming across two server folders would be a copy; it is refused.
    assert.equal((await client.send("RNFR survival-12/maps/rotation.conf")).code, 350);
    assert.equal((await client.send("RNTO nota-server/maps/x.conf")).code, 550);

    assert.equal((await client.send("DELE survival-12/maps/rotation.conf")).code, 250);
    assert.equal((await client.send("RMD survival-12/maps")).code, 250);
    assert.equal(existsSync(join(root, "maps")), false);
    client.close();
  });
});

describe("containment and abuse", LIVE, () => {
  test("traversal out of the server folder is refused everywhere", async () => {
    const client = await connected();
    await client.login("alice", "sekret");

    assert.equal((await client.send("CWD ../..")).code, 550);
    assert.equal((await client.send("CWD /etc")).code, 550);
    assert.equal((await client.send("MKD ../escape")).code, 553);
    assert.equal((await client.send("STOR ../../escape.txt")).code, 553);
    assert.equal((await client.send("DELE ../../../etc/hostname")).code, 550);
    assert.equal((await client.send("SIZE ../../etc/passwd")).code, 550);
    assert.equal((await client.send("RNFR ../../etc/hostname")).code, 550);
    assert.equal(existsSync(join(root, "..", "escape.txt")), false);
    assert.equal(existsSync(join(root, "..", "escape")), false);
    client.close();
  });

  test("the server root cannot be removed or renamed", async () => {
    const client = await connected();
    await client.login("alice", "sekret");
    assert.equal((await client.send("RMD survival-12")).code, 550);
    assert.equal((await client.send("DELE survival-12")).code, 550);
    assert.ok(existsSync(root));
    client.close();
  });

  test("storing outside a folder of the virtual root is refused", async () => {
    const client = await connected();
    await client.login("alice", "sekret");
    // `notaserver` is not one of this account's folders.
    assert.equal((await client.send("STOR notaserver/x.bin")).code, 550);
    assert.equal((await client.send("CWD notaserver")).code, 550);
    client.close();
  });

  test("active mode may only dial the client that asked for it", async () => {
    const client = await connected();
    await client.login("alice", "sekret");

    // The client's own address is the one legitimate target.
    const own = await client.send("PORT 127,0,0,1,7,7");
    assert.equal(own.code, 200);

    // The classic bounce: a third party, or an internal admin port.
    const bounce = await client.send("PORT 10,0,0,1,7,7");
    assert.equal(bounce.code, 501);
    assert.match(bounce.lines[0], /must match/i);
    assert.equal((await client.send("EPRT |1|10.0.0.1|2121|")).code, 501);
    client.close();
  });

  test("anonymous logins are simply not a thing here", async () => {
    const client = await connected();
    assert.equal(await client.login("anonymous", "me@example.com"), 530);
    client.close();
  });
});

describe("explicit FTPS (AUTH TLS)", LIVE, () => {
  let tlsServer: FtpServer;
  let tlsPort: number;
  let tlsRoot: string;

  before(async () => {
    tlsRoot = makeTree();
    tlsServer = new FtpServer({
      host: "127.0.0.1",
      port: 0,
      passivePortMin: 51100,
      passivePortMax: 51140,
      tls: {
        cert: readFixture(join(process.cwd(), "tests/fixtures/ftp-tls-cert.pem"), "utf8"),
        key: readFixture(join(process.cwd(), "tests/fixtures/ftp-tls-key.pem"), "utf8"),
      },
      authenticate: async (username, password) =>
        username === "alice" && password === "sekret"
          ? {
              accountId: 3,
              username: "alice",
              userId: 9,
              folders: [{ name: "survival-12", absPath: tlsRoot, serverId: 12, label: "Survival" }],
              rootedAtServer: false,
            }
          : null,
    });
    tlsPort = (await tlsServer.start()).port;
  });

  after(async () => {
    await tlsServer.stop();
    rmSync(tlsRoot, { recursive: true, force: true });
  });

  test("advertises AUTH TLS once a certificate is configured", async () => {
    const client = await TestClient.connect(tlsPort);
    await client.read();
    const feat = await client.send("FEAT");
    assert.match(feat.lines.join("\n"), /AUTH TLS/);
    client.close();
  });

  test("upgrades the control and data connections, then lists over TLS", async () => {
    const client = await TestClient.connect(tlsPort);
    await client.read();
    await client.startTls();
    assert.equal(await client.login("alice", "sekret"), 230);
    assert.equal((await client.send("PBSZ 0")).code, 200);
    assert.equal((await client.send("PROT P")).code, 200);

    const data = await client.passiveTls();
    const chunks: Buffer[] = [];
    data.on("data", (c: Buffer) => chunks.push(c));
    assert.equal((await client.send("MLSD")).code, 150);
    await new Promise((resolve) => data.on("close", resolve));
    assert.match(Buffer.concat(chunks).toString("utf8"), /survival-12/);
    assert.equal((await client.read()).code, 226);

    // An encrypted upload must land byte-for-byte.
    const upload = await client.passiveTls();
    assert.equal((await client.send("STOR survival-12/secure.bin")).code, 150);
    await new Promise<void>((resolve) => upload.end("encrypted payload", () => resolve()));
    assert.equal((await client.read()).code, 226);
    assert.equal(readFileSync(join(tlsRoot, "secure.bin"), "utf8"), "encrypted payload");
    client.close();
  });

  test("PROT is refused before the connection is encrypted", async () => {
    const client = await TestClient.connect(tlsPort);
    await client.read();
    await client.login("alice", "sekret");
    assert.equal((await client.send("PROT P")).code, 503);
    client.close();
  });
});

describe("server lifecycle", LIVE, () => {
  test("reports live stats and stops cleanly", async () => {
    const tempRoot = makeTree();
    const smaller = new FtpServer({
      host: "127.0.0.1",
      port: 0,
      passivePortMin: 51050,
      passivePortMax: 51060,
      authenticate: async () => ({
        accountId: 2,
        username: "bob",
        userId: 8,
        folders: [{ name: "srv-1", absPath: tempRoot, serverId: 1, label: "One" }],
        rootedAtServer: false,
      }),
    });
    const bound = await smaller.start();
    const client = await TestClient.connect(bound.port);
    await client.read();
    await client.login("bob", "anything");
    assert.equal(smaller.stats().loggedIn, 1);
    assert.deepEqual(smaller.stats().usernames, ["bob"]);

    // Kicking a session drops the client but leaves the listener up.
    assert.equal(smaller.disconnectUser("bob"), 1);
    await smaller.stop();
    assert.equal(smaller.stats().listening, false);
    client.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });
});

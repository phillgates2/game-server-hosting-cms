// ═══════════════════════════════════════════════════════════════
// Source RCON Protocol Implementation
// Supports: CS2, TF2, Garry's Mod, Rust, L4D2, Insurgency,
//           Minecraft, Palworld, ARK, 7DTD, and any Source RCON game
// ═══════════════════════════════════════════════════════════════

import { Socket } from "net";

const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

interface RconPacket {
  size: number;
  id: number;
  type: number;
  body: string;
}

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf8");
  const size = 4 + 4 + bodyBuf.length + 2; // id + type + body + 2 null terminators
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeUInt8(0, 12 + bodyBuf.length);
  buf.writeUInt8(0, 13 + bodyBuf.length);
  return buf;
}

function decodePacket(buf: Buffer): RconPacket | null {
  if (buf.length < 14) return null;
  const size = buf.readInt32LE(0);
  if (buf.length < 4 + size) return null;
  return {
    size,
    id: buf.readInt32LE(4),
    type: buf.readInt32LE(8),
    body: buf.toString("utf8", 12, 12 + size - 10), // minus id(4) + type(4) + 2 nulls
  };
}

export interface RconResult {
  success: boolean;
  response: string;
  error?: string;
  duration: number;
}

export async function sendRconCommand(
  host: string,
  port: number,
  password: string,
  command: string,
  timeout: number = 10000
): Promise<RconResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const socket = new Socket();
    let buffer = Buffer.alloc(0);
    let authenticated = false;
    let responseBody = "";
    let resolved = false;

    const finish = (result: RconResult) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ success: false, response: "", error: "Connection timed out", duration: Date.now() - start });
    }, timeout);

    socket.on("error", (err) => {
      clearTimeout(timer);
      finish({ success: false, response: "", error: err.message, duration: Date.now() - start });
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!resolved) {
        finish({
          success: authenticated,
          response: responseBody,
          error: authenticated ? undefined : "Connection closed before auth",
          duration: Date.now() - start,
        });
      }
    });

    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      // Process all complete packets in buffer
      while (buffer.length >= 4) {
        const packetSize = buffer.readInt32LE(0);
        if (buffer.length < 4 + packetSize) break; // Incomplete packet

        const packetBuf = buffer.subarray(0, 4 + packetSize);
        buffer = buffer.subarray(4 + packetSize);

        const packet = decodePacket(packetBuf);
        if (!packet) continue;

        if (!authenticated) {
          // Auth response
          if (packet.type === SERVERDATA_AUTH_RESPONSE) {
            if (packet.id === -1) {
              clearTimeout(timer);
              finish({ success: false, response: "", error: "Authentication failed — wrong RCON password", duration: Date.now() - start });
              return;
            }
            authenticated = true;
            // Send command
            socket.write(encodePacket(1, SERVERDATA_EXECCOMMAND, command));
            // Send empty follow-up to detect end of multi-packet response
            socket.write(encodePacket(2, SERVERDATA_RESPONSE_VALUE, ""));
          }
        } else {
          // Command response
          if (packet.type === SERVERDATA_RESPONSE_VALUE) {
            if (packet.id === 2) {
              // End marker — we got the full response
              clearTimeout(timer);
              finish({ success: true, response: responseBody.trim(), duration: Date.now() - start });
              return;
            }
            responseBody += packet.body;
          }
        }
      }
    });

    socket.connect(port, host, () => {
      // Send auth
      socket.write(encodePacket(0, SERVERDATA_AUTH, password));
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// UDP RCON for older games (Quake, ET:Legacy, etc.)
// ═══════════════════════════════════════════════════════════════

import { createSocket } from "dgram";

export async function sendUdpRcon(
  host: string,
  port: number,
  password: string,
  command: string,
  timeout: number = 5000
): Promise<RconResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let resolved = false;
    let responseBody = "";

    const finish = (result: RconResult) => {
      if (resolved) return;
      resolved = true;
      try { socket.close(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ success: false, response: "", error: "Connection timed out", duration: Date.now() - start });
    }, timeout);

    // Quake 3 / id Tech 3 RCON format: \xFF\xFF\xFF\xFFrcon <password> <command>
    const msgStr = `\xFF\xFF\xFF\xFFrcon ${password} ${command}`;
    const msg: Uint8Array = new Uint8Array(Buffer.from(msgStr));

    socket.on("error", (err) => {
      clearTimeout(timer);
      finish({ success: false, response: "", error: err.message, duration: Date.now() - start });
    });

    socket.on("message", (data) => {
      // Response starts with \xFF\xFF\xFF\xFFprint\n
      let body = data.toString("utf8");
      if (body.startsWith("\xFF\xFF\xFF\xFFprint\n")) {
        body = body.slice(10);
      } else if (body.startsWith("\xFF\xFF\xFF\xFF")) {
        body = body.slice(4);
      }
      responseBody += body;

      // Wait a short time for multi-packet responses
      clearTimeout(timer);
      setTimeout(() => {
        finish({ success: true, response: responseBody.trim(), duration: Date.now() - start });
      }, 200);
    });

    socket.send(msg, 0, msg.length, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        finish({ success: false, response: "", error: err.message, duration: Date.now() - start });
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Web RCON for Rust (WebSocket-based)
// ═══════════════════════════════════════════════════════════════

export async function sendWebRcon(
  host: string,
  port: number,
  password: string,
  command: string,
  timeout: number = 10000
): Promise<RconResult> {
  const start = Date.now();

  // Rust WebSocket RCON uses a simple JSON protocol over HTTP
  // The panel makes an HTTP request to simulate it since we don't persist WS connections
  const url = `http://${host}:${port}/${password}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Identifier: 1, Message: command, Name: "GSM Panel" }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      return { success: false, response: "", error: `HTTP ${res.status}`, duration: Date.now() - start };
    }

    const data = await res.json();
    return { success: true, response: data.Message || JSON.stringify(data), duration: Date.now() - start };
  } catch (e: unknown) {
    return {
      success: false,
      response: "",
      error: e instanceof Error ? e.message : "WebRCON failed",
      duration: Date.now() - start,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Protocol detection based on game slug
// ═══════════════════════════════════════════════════════════════

export type RconProtocol = "source" | "udp" | "webrcon" | "none";

export function detectRconProtocol(gameSlug: string): RconProtocol {
  const SOURCE_GAMES = [
    "cs2", "csgo", "tf2", "gmod", "l4d2", "insurgency-sandstorm", "squad",
    "minecraft-java", "minecraft-paper", "palworld", "ark", "ark-sa",
    "7dtd", "satisfactory", "terraria", "space-engineers", "stationeers",
    "unturned", "project-zomboid", "barotrauma", "conan-exiles",
    "dont-starve-together", "mordhau", "chivalry2", "assetto-corsa",
    "assetto-corsa-competizione", "farming-simulator-22", "enshrouded",
    "valheim", "vrising", "dayz", "sons-of-the-forest", "the-forest",
    "arma3", "arma-reforger", "eco", "avorion",
  ];

  const UDP_GAMES = [
    "wolfenstein-et", "openra", "quake-live", "xonotic",
  ];

  const WEBRCON_GAMES = ["rust"];

  if (WEBRCON_GAMES.includes(gameSlug)) return "webrcon";
  if (UDP_GAMES.includes(gameSlug)) return "udp";
  if (SOURCE_GAMES.includes(gameSlug)) return "source";
  return "source"; // Default to Source RCON
}

export async function sendRcon(
  protocol: RconProtocol,
  host: string,
  port: number,
  password: string,
  command: string,
): Promise<RconResult> {
  switch (protocol) {
    case "source":
      return sendRconCommand(host, port, password, command);
    case "udp":
      return sendUdpRcon(host, port, password, command);
    case "webrcon":
      return sendWebRcon(host, port, password, command);
    case "none":
      return { success: false, response: "", error: "This game does not support RCON", duration: 0 };
  }
}

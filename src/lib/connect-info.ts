/**
 * Connection info: the exact string a player needs to join a server, in the
 * shape each game expects. Pure so it is unit-tested and shared between the
 * panel UI and anything else that renders join instructions.
 *
 * Privacy note: the anonymous status surface (/status, boards, embeds)
 * deliberately never exposes addresses — this belongs to operators and
 * people they share the string with.
 */

/** Games whose in-game console accepts `connect host:port`. */
export const CONNECT_CONSOLE_SLUGS = new Set([
  "tf2",
  "gmod",
  "l4d2",
  "counter-strike-source",
  "cs2",
  "insurgency-sandstorm",
  "quake-live",
  "xonotic",
  "wolfenstein-et",
]);

/** Minecraft Java-edition families: players enter the bare address. */
export const MINECRAFT_JAVA_SLUGS = new Set([
  "minecraft-java",
  "minecraft-paper",
  "minecraft-neoforge",
  "minecraft-fabric",
]);

export const MINECRAFT_JAVA_DEFAULT_PORT = 25565;
export const MINECRAFT_BEDROCK_DEFAULT_PORT = 19132;

export interface ConnectInfo {
  /** What to paste/type, or null when the server has no usable address. */
  connect: string | null;
  /** host[:port] without any game-specific wrapping. */
  address: string | null;
  /** One-line instruction shown next to the string. */
  hint: string;
}

/** Pick the publicly routable address: prefer IPv4, fall back to IPv6. */
export function pickHost(ipv4: string | null, ipv6: string | null): string | null {
  if (ipv4 && ipv4.trim() && ipv4.trim() !== "0.0.0.0") return ipv4.trim();
  if (ipv6 && ipv6.trim()) {
    const v6 = ipv6.trim();
    return v6.includes(":") ? `[${v6}]` : v6;
  }
  return null;
}

export function connectInfoFor(
  gameSlug: string | null,
  ipv4: string | null,
  ipv6: string | null,
  port: number
): ConnectInfo {
  const host = pickHost(ipv4, ipv6);
  if (!host) {
    return { connect: null, address: null, hint: "This server has no public address configured." };
  }

  const slug = (gameSlug || "").toLowerCase();
  const hostPort = `${host}:${port}`;

  if (CONNECT_CONSOLE_SLUGS.has(slug)) {
    return {
      connect: `connect ${hostPort}`,
      address: hostPort,
      hint: "Open the in-game console (~) and paste this.",
    };
  }

  if (MINECRAFT_JAVA_SLUGS.has(slug)) {
    // Java clients default 25565 — the bare address is what players type.
    const address = port === MINECRAFT_JAVA_DEFAULT_PORT ? host : hostPort;
    return {
      connect: address,
      address,
      hint: "Multiplayer → Add Server → paste into Server Address.",
    };
  }

  if (slug === "minecraft-bedrock") {
    const address = port === MINECRAFT_BEDROCK_DEFAULT_PORT ? host : hostPort;
    return {
      connect: address,
      address,
      hint: "Play → Servers → Add Server → paste the address.",
    };
  }

  return {
    connect: hostPort,
    address: hostPort,
    hint: "Join via the game's server browser or connect screen.",
  };
}

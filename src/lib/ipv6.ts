import { execSync } from "child_process";

// ─── Types ───

export interface NetworkInterface {
  name: string;
  ipv4: string[];
  ipv6: string[];
  mac: string;
  state: "up" | "down" | "unknown";
  mtu: number;
}

export interface IPv6Status {
  enabled: boolean;
  supported: boolean;
  forwarding: boolean;
  addresses: IPv6Address[];
  interfaces: NetworkInterface[];
  defaultGateway6: string;
  dnsServers: string[];
}

export interface IPv6Address {
  address: string;
  prefix: number;
  scope: "global" | "link" | "host" | "site" | "unknown";
  iface: string;
  type: "static" | "slaac" | "dhcpv6" | "temporary" | "unknown";
}

// ─── Validation ───

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;
const IPV6_REGEX = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/;

export function isIPv4(address: string): boolean {
  return IPV4_REGEX.test(address.trim());
}

export function isIPv6(address: string): boolean {
  // Strip zone ID (e.g., %eth0)
  const clean = address.trim().replace(/%[a-zA-Z0-9]+$/, "");
  return IPV6_REGEX.test(clean);
}

export function isValidIP(address: string): boolean {
  return isIPv4(address) || isIPv6(address);
}

export function getIPVersion(address: string): 4 | 6 | null {
  if (isIPv4(address)) return 4;
  if (isIPv6(address)) return 6;
  return null;
}

// ─── Formatting ───

/**
 * Format an IP address with port for display / connection strings.
 * IPv6 addresses get wrapped in brackets: [::1]:27015
 * IPv4 stays as-is: 10.0.0.1:27015
 */
export function formatIPPort(ip: string, port: number): string {
  if (isIPv6(ip)) {
    return `[${ip}]:${port}`;
  }
  return `${ip}:${port}`;
}

/**
 * Format an IP address for URL usage (e.g. http://[::1]:3000)
 */
export function formatIPForURL(ip: string, port?: number): string {
  const host = isIPv6(ip) ? `[${ip}]` : ip;
  if (port) return `${host}:${port}`;
  return host;
}

/**
 * Expand a shortened IPv6 address to its full 8-group notation.
 */
export function expandIPv6(address: string): string {
  const clean = address.replace(/%[a-zA-Z0-9]+$/, "");
  let groups = clean.split(":");
  const dblIdx = groups.indexOf("");

  if (dblIdx !== -1) {
    // Handle :: expansion
    const before = groups.slice(0, dblIdx).filter(g => g !== "");
    const after = groups.slice(dblIdx + 1).filter(g => g !== "");
    const missing = 8 - before.length - after.length;
    groups = [...before, ...Array(missing).fill("0000"), ...after];
  }

  return groups.map(g => g.padStart(4, "0")).join(":");
}

/**
 * Compress an IPv6 address (collapse longest run of :0000: → ::)
 */
export function compressIPv6(address: string): string {
  const expanded = expandIPv6(address);
  const groups = expanded.split(":");

  // Find longest run of all-zero groups
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0000") {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen <= 1) {
    return groups.map(g => g.replace(/^0+/, "") || "0").join(":");
  }

  const before = groups.slice(0, bestStart).map(g => g.replace(/^0+/, "") || "0");
  const after = groups.slice(bestStart + bestLen).map(g => g.replace(/^0+/, "") || "0");

  if (before.length === 0 && after.length === 0) return "::";
  if (before.length === 0) return "::" + after.join(":");
  if (after.length === 0) return before.join(":") + "::";
  return before.join(":") + "::" + after.join(":");
}

/**
 * Get the scope of an IPv6 address.
 */
export function getIPv6Scope(address: string): "global" | "link" | "host" | "site" | "unknown" {
  const lower = address.toLowerCase();
  if (lower === "::1") return "host";
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return "link";
  if (lower.startsWith("fec0:")) return "site";
  if (lower.startsWith("2") || lower.startsWith("3")) return "global";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "global"; // ULA
  return "unknown";
}

/**
 * Determine a human-friendly label for an IPv6 address.
 */
export function getIPv6Label(address: string): string {
  const scope = getIPv6Scope(address);
  const lower = address.toLowerCase();
  if (lower === "::1") return "Loopback";
  if (scope === "link") return "Link-Local";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "Unique Local (ULA)";
  if (scope === "global") return "Global";
  return "Other";
}

// ─── System IPv6 Detection ───

export function getIPv6Status(): IPv6Status {
  const result: IPv6Status = {
    enabled: false,
    supported: false,
    forwarding: false,
    addresses: [],
    interfaces: [],
    defaultGateway6: "",
    dnsServers: [],
  };

  try {
    // Check kernel IPv6 support
    try {
      const modCheck = execSync("test -d /proc/sys/net/ipv6 && echo yes || echo no", { encoding: "utf-8" }).trim();
      result.supported = modCheck === "yes";
    } catch {
      result.supported = false;
    }

    if (!result.supported) return result;

    // Check if IPv6 is disabled via sysctl
    try {
      const disableAll = execSync("cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null", { encoding: "utf-8" }).trim();
      result.enabled = disableAll === "0";
    } catch {
      result.enabled = false;
    }

    // Check forwarding
    try {
      const fwd = execSync("cat /proc/sys/net/ipv6/conf/all/forwarding 2>/dev/null", { encoding: "utf-8" }).trim();
      result.forwarding = fwd === "1";
    } catch {
      result.forwarding = false;
    }

    // Get interfaces with ip -6
    try {
      const output = execSync("ip -6 addr show 2>/dev/null", { encoding: "utf-8" });
      let currentIface = "";

      for (const line of output.split("\n")) {
        const ifaceMatch = line.match(/^\d+:\s+(\S+?)[@:].*state\s+(\S+)/);
        if (ifaceMatch) {
          currentIface = ifaceMatch[1];
          continue;
        }

        const addrMatch = line.match(/\s+inet6\s+([0-9a-fA-F:]+)\/(\d+)\s+scope\s+(\S+)/);
        if (addrMatch && currentIface) {
          result.addresses.push({
            address: addrMatch[1],
            prefix: parseInt(addrMatch[2], 10),
            scope: addrMatch[3] as "global" | "link" | "host",
            iface: currentIface,
            type: "unknown",
          });
        }
      }
    } catch {
      // fallback
    }

    if (result.addresses.length > 0) {
      result.enabled = true;
    }

    // Default gateway
    try {
      const gw = execSync("ip -6 route show default 2>/dev/null | head -1", { encoding: "utf-8" }).trim();
      const gwMatch = gw.match(/via\s+([0-9a-fA-F:]+)/);
      if (gwMatch) result.defaultGateway6 = gwMatch[1];
    } catch {
      // no default v6 route
    }

    // DNS
    try {
      const resolv = execSync("cat /etc/resolv.conf 2>/dev/null", { encoding: "utf-8" });
      for (const line of resolv.split("\n")) {
        const match = line.match(/^nameserver\s+(.+)/);
        if (match) {
          result.dnsServers.push(match[1].trim());
        }
      }
    } catch {
      // no resolv.conf
    }

    // Gather full network interfaces
    result.interfaces = getNetworkInterfaces();

  } catch {
    // return defaults
  }

  return result;
}

export function getNetworkInterfaces(): NetworkInterface[] {
  const interfaces: NetworkInterface[] = [];

  try {
    const os = require("os");
    const ifaces = os.networkInterfaces();

    for (const [name, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      const iface: NetworkInterface = {
        name,
        ipv4: [],
        ipv6: [],
        mac: "",
        state: "up",
        mtu: 1500,
      };

      for (const addr of addrs as Array<{ address: string; family: string; mac: string }>) {
        if (addr.family === "IPv4") iface.ipv4.push(addr.address);
        else if (addr.family === "IPv6") iface.ipv6.push(addr.address);
        if (addr.mac && addr.mac !== "00:00:00:00:00:00") iface.mac = addr.mac;
      }

      interfaces.push(iface);
    }
  } catch {
    // fallback
  }

  // Try to get MTU from ip link
  try {
    const output = execSync("ip link show 2>/dev/null", { encoding: "utf-8" });
    for (const line of output.split("\n")) {
      const match = line.match(/^\d+:\s+(\S+?)[@:].*mtu\s+(\d+).*state\s+(\S+)/);
      if (match) {
        const iface = interfaces.find(i => i.name === match[1]);
        if (iface) {
          iface.mtu = parseInt(match[2], 10);
          iface.state = match[3].toLowerCase() === "up" ? "up" : "down";
        }
      }
    }
  } catch {
    // no ip command
  }

  return interfaces;
}

/**
 * Test IPv6 connectivity by attempting to resolve/connect to an IPv6 host.
 */
export function testIPv6Connectivity(): { reachable: boolean; latencyMs: number; target: string; error?: string } {
  const targets = [
    { host: "ipv6.google.com", label: "Google IPv6" },
    { host: "2001:4860:4860::8888", label: "Google DNS6" },
  ];

  for (const target of targets) {
    try {
      const start = Date.now();
      execSync(`ping -6 -c 1 -W 3 ${target.host} 2>/dev/null`, { encoding: "utf-8", timeout: 5000 });
      return {
        reachable: true,
        latencyMs: Date.now() - start,
        target: target.label,
      };
    } catch {
      continue;
    }
  }

  return {
    reachable: false,
    latencyMs: 0,
    target: targets[0].label,
    error: "No IPv6 connectivity detected",
  };
}

/**
 * Build a dual-stack connect string for display.
 */
export function buildConnectString(ipv4: string, ipv6: string | null, port: number): {
  v4: string;
  v6: string | null;
  preferred: string;
} {
  const v4 = `${ipv4}:${port}`;
  const v6 = ipv6 ? `[${ipv6}]:${port}` : null;
  return {
    v4,
    v6,
    preferred: v6 || v4,
  };
}

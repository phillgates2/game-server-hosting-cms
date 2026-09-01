import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * This panel executes shell commands, edits files on disk and holds database
 * credentials, so a successful XSS or clickjacking attack against a logged-in
 * admin is equivalent to remote code execution on the host. These headers are
 * the cheap defence-in-depth layer.
 *
 * The CSP deliberately allows 'unsafe-inline' for styles: Tailwind and the
 * runtime theme editor both set inline style attributes, and the custom theme
 * feature writes CSS custom properties directly onto elements. Scripts do not
 * get 'unsafe-inline' in production.
 */
const securityHeaders = [
  // Stop the browser from MIME-sniffing a response into something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Block framing entirely - the panel is never meant to be embedded.
  { key: "X-Frame-Options", value: "DENY" },
  // Do not leak panel URLs (which contain server ids) to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Turn off browser features the panel never uses.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Only meaningful over HTTPS; harmless otherwise. Caddy terminates TLS.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; in dev it also needs eval for HMR.
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Same-origin API plus websockets for live logs, RCON and metrics.
  isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // The gateway bot is loaded at runtime via a non-analyzable import; keep it
  // out of the bundler so server bundles stay small on memory-constrained
  // hosts. (sql.js was deliberately dropped — a zero-dependency SQLite reader
  // replaced it, see src/lib/sqlite-reader.ts.)
  serverExternalPackages: ["discord.js"],
  outputFileTracingExcludes: {
    "/api/servers/[id]/process": ["./next.config.ts"],
    "/api/servers/[id]/update": ["./next.config.ts"],
    "/api/servers/[id]/files": ["./next.config.ts"],
    "/api/servers/[id]/process/route": ["./next.config.ts"],
    "/api/servers/[id]/update/route": ["./next.config.ts"],
    "/api/servers/[id]/files/route": ["./next.config.ts"],
    "/api/servers": ["./next.config.ts"],
    "/api/servers/route": ["./next.config.ts"],
  },

  // Do not advertise the framework version to attackers.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders, { key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default nextConfig;

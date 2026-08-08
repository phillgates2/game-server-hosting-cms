import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;

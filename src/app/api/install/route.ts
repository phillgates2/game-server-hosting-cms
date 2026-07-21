import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { siteSettings, users, games, nodes, plans, forumCategories } from "@/db/schema";
import { hashPassword, createToken } from "@/lib/auth";
import { GAME_TEMPLATES } from "@/lib/game-installer";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const result = await db.select().from(siteSettings).where(eq(siteSettings.key, "installed")).limit(1);
    return NextResponse.json({ installed: result.length > 0 && result[0].value === "true" });
  } catch {
    return NextResponse.json({ installed: false });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check if already installed
    const existing = await db.select().from(siteSettings).where(eq(siteSettings.key, "installed")).limit(1);
    if (existing.length > 0 && existing[0].value === "true") {
      return NextResponse.json({ error: "Already installed" }, { status: 400 });
    }

    const body = await request.json();
    const { siteName, adminUsername, adminEmail, adminPassword } = body;

    if (!siteName || !adminUsername || !adminEmail || !adminPassword) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }

    // Store site settings
    const settingsToInsert = [
      { key: "site_name", value: siteName },
      { key: "installed", value: "true" },
      { key: "installed_at", value: new Date().toISOString() },
      { key: "version", value: "1.0.0" },
    ];

    for (const s of settingsToInsert) {
      await db.insert(siteSettings).values(s);
    }

    // Create admin user
    const passwordHash = await hashPassword(adminPassword);
    const adminResult = await db.insert(users).values({
      username: adminUsername,
      email: adminEmail,
      passwordHash,
      role: "admin",
    }).returning();

    // Seed games from templates
    for (const tmpl of GAME_TEMPLATES) {
      await db.insert(games).values({
        name: tmpl.name,
        slug: tmpl.slug,
        description: tmpl.description,
        defaultPort: tmpl.defaultPort,
        steamAppId: tmpl.steamAppId || null,
        installScript: tmpl.installScript,
        startCommand: tmpl.startCommand,
        configTemplate: tmpl.configTemplate,
        isActive: true,
      });
    }

    // Seed a default node (dual-stack)
    await db.insert(nodes).values({
      name: "Node-01 (Primary)",
      ipAddress: "10.0.0.1",
      ip6Address: "2001:db8::1",
      ip6Enabled: true,
      port: 22,
      maxSlots: 500,
      usedSlots: 0,
      status: "online",
      location: "US East",
    });

    // Seed default plans
    const defaultPlans = [
      { name: "Starter", description: "Perfect for small communities", priceMonthly: 499, slots: 10, ramMb: 2048, diskMb: 10240, cpuPercent: 50 },
      { name: "Standard", description: "Great for growing servers", priceMonthly: 999, slots: 32, ramMb: 4096, diskMb: 25600, cpuPercent: 100 },
      { name: "Premium", description: "Maximum performance", priceMonthly: 1999, slots: 64, ramMb: 8192, diskMb: 51200, cpuPercent: 200 },
      { name: "Enterprise", description: "Custom solutions for large networks", priceMonthly: 4999, slots: 128, ramMb: 16384, diskMb: 102400, cpuPercent: 400 },
    ];
    for (const p of defaultPlans) {
      await db.insert(plans).values(p);
    }

    // Seed forum categories
    const categories = [
      { name: "Announcements", description: "Official news and updates", slug: "announcements", sortOrder: 1 },
      { name: "General Discussion", description: "Chat about anything gaming-related", slug: "general", sortOrder: 2 },
      { name: "Game Servers", description: "Server setup, configs, and troubleshooting", slug: "game-servers", sortOrder: 3 },
      { name: "Support", description: "Get help from staff and community", slug: "support", sortOrder: 4 },
      { name: "Off-Topic", description: "Everything else", slug: "off-topic", sortOrder: 5 },
    ];
    for (const c of categories) {
      await db.insert(forumCategories).values(c);
    }

    // Create auth token for admin
    const admin = adminResult[0];
    const token = createToken({
      userId: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
    });

    const response = NextResponse.json({ success: true, message: "Installation complete!" });
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Installation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

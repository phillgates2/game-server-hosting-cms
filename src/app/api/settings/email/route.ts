import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { isEmailConfigured, sendEmail } from "@/lib/email";

// GET /api/settings/email — Check email config status
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  return NextResponse.json({
    configured: isEmailConfigured(),
    host: process.env.SMTP_HOST || "",
    port: process.env.SMTP_PORT || "587",
    from: process.env.SMTP_FROM || "",
    hasAuth: !!(process.env.SMTP_USER),
  });
}

// POST /api/settings/email — Send test email
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { to } = await req.json();
    if (!to) return NextResponse.json({ error: "Recipient email required" }, { status: 400 });

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: "SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in .env" }, { status: 400 });
    }

    const ok = await sendEmail(to, "GSM Test Email", `<div style="font-family:sans-serif;padding:20px;background:#151c2c;color:#e2e8f0;border-radius:12px"><h2>✅ Email Works!</h2><p>This is a test email from GameServer Manager.</p></div>`);

    return NextResponse.json({ ok, message: ok ? "Test email sent" : "Failed to send" });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

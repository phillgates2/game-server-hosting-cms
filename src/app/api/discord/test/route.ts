import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { sendDiscordWebhook } from "@/lib/discord";
import { apiError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!((await hasPermission(auth.userId, "panel.discord")) || (await hasPermission(auth.userId, "servers.edit")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { webhookUrl, serverName, gameName } = await req.json();
    
    if (!webhookUrl) {
      return NextResponse.json({ error: "Webhook URL required" }, { status: 400 });
    }

    const result = await sendDiscordWebhook(webhookUrl, {
      serverName: serverName || "Test Server",
      gameName: gameName || "Unknown Game",
      port: 27015,
      event: "server_created",
      message: `🔔 **Webhook Test**\n\nThis is a test notification from GameServer Manager!\n\nIf you see this message, your Discord webhook is configured correctly.`,
    });

    if (result.success) {
      return NextResponse.json({ ok: true, message: "Test webhook sent successfully!" });
    } else {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  } catch (e: unknown) {
    return apiError(e, "Unknown error", 500);
  }
}

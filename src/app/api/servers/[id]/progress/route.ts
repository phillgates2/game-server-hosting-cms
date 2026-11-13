import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { getProgress, pollRemoteProgress } from "@/lib/install-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/servers/[id]/progress — live status of a running install/update.
//
// Answers { active, status, progress }: `progress` is the meter state (phase,
// what is being downloaded, percent, bytes, speed, ETA, log tail) or null when
// nothing has run recently. Installer output can contain tokens and paths, so
// access mirrors the console log: owner, admin, or operator collaborator.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const serverId = Number(id);
    if (!Number.isInteger(serverId) || serverId <= 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const [server] = await db
      .select({ id: gameServers.id, userId: gameServers.userId, status: gameServers.status })
      .from(gameServers)
      .where(eq(gameServers.id, serverId))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (auth.role !== "admin" && server.userId !== auth.userId) {
      const { getCollaboratorRole } = await import("@/lib/server-collab");
      const collabRole = await getCollaboratorRole(server.id, auth.userId);
      if (collabRole !== "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Remote installs: pull fresh output from the node agent (rate-limited
    // inside), so remote progress costs nothing while nobody is watching.
    await pollRemoteProgress(server.id);
    const progress = getProgress(server.id);

    return NextResponse.json(
      {
        active: Boolean(progress && progress.finishedAt === null),
        status: server.status,
        progress,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: unknown) {
    return apiError(e, "Could not read install progress", 500);
  }
}

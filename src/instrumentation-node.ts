/**
 * Node-only half of the boot hook.
 *
 * Kept in its own module because Next bundles instrumentation.ts for the edge
 * runtime as well, and edge cannot resolve node:path / child_process. The
 * runtime guard in instrumentation.ts means this file is only ever imported
 * under Node.
 */

/**
 * Start the scheduled-task runner.
 *
 * Tasks are due in the database regardless of who is watching; a server-side
 * timer is the only thing that can fire them, so it lives here rather than
 * in a dashboard poll. Best-effort: a failure to boot is logged, not fatal.
 */
export async function startSchedulerTimer() {
  if (process.env.GSM_DISABLE_SCHEDULER === "true") return;
  try {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    console.log("[scheduler] started (30s tick)");
  } catch (e: unknown) {
    console.error("[scheduler] could not start:", e instanceof Error ? e.message : e);
  }
}

/** Load operator settings so auth.ts has them before the first request. */
export async function loadAuthPolicy() {
  try {
    const { getAuthPolicy } = await import("@/lib/auth-policy");
    await getAuthPolicy();
  } catch (e: unknown) {
    console.error("[settings] could not load auth policy:", e instanceof Error ? e.message : e);
  }
}

export async function startBootServers() {
  try {
    const { db } = await import("@/db");
    const { gameServers, nodes } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
    const { isProcessAlive, startDetachedScript } = await import("@/lib/process-control");
    const { join } = await import("node:path");

    const candidates = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        pid: gameServers.pid,
        status: gameServers.status,
        installPath: gameServers.installPath,
      })
      .from(gameServers)
      // Only servers on this machine: a remote node's processes are not ours
      // to spawn, exactly as the start/stop route already refuses them.
      .innerJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(and(eq(gameServers.autoStart, true), eq(nodes.isLocal, true)));

    if (candidates.length === 0) return;
    console.log(`[auto-start] ${candidates.length} server(s) marked start-on-boot`);

    for (const server of candidates) {
      try {
        // Survived the restart (panel restarted, machine did not) — leave it.
        if (server.pid && isProcessAlive(server.pid)) {
          console.log(`[auto-start] "${server.name}" already running (pid ${server.pid})`);
          continue;
        }

        const { pid, alive } = await startDetachedScript(
          join(String(server.installPath), "gsm-start.sh")
        );

        await db
          .update(gameServers)
          .set({
            status: alive ? "running" : "stopped",
            pid: alive ? pid : null,
            lastStarted: alive ? new Date() : undefined,
            updatedAt: new Date(),
          })
          .where(eq(gameServers.id, server.id));

        console.log(
          `[auto-start] "${server.name}" ${alive ? `started (pid ${pid})` : "failed to start"}`
        );
      } catch (e: unknown) {
        console.error(
          `[auto-start] "${server.name}" threw:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  } catch (e: unknown) {
    // No database yet (fresh install, migrations pending) is expected.
    console.error("[auto-start] skipped:", e instanceof Error ? e.message : e);
  }
}

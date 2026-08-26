/**
 * Next.js boot hook.
 *
 * Runs once when the server process starts (including after a machine reboot,
 * because the panel runs under systemd). This is where "Start on node boot"
 * is honoured: the autoStart column existed and was written on clone, but
 * nothing ever read it, so the setting did nothing.
 *
 * Everything here is best-effort — a panel that cannot reach the database or
 * a game server that refuses to launch must never stop the panel from booting.
 */

export async function register() {
  // Only the Node.js runtime can spawn processes; skip the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Booting game servers during `next build` would be actively harmful.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.GSM_DISABLE_AUTOSTART === "true") return;

  // Deferred so a slow or unreachable database does not delay readiness.
  const { startBootServers, loadAuthPolicy, startSchedulerTimer } = await import("./instrumentation-node");
  // Auth settings are cheap and needed by the first request.
  void loadAuthPolicy();
  // Scheduled tasks fire on a server-side timer, not from a dashboard poll.
  void startSchedulerTimer();
  setTimeout(() => {
    void startBootServers();
  }, 5_000);
}

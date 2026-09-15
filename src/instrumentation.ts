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

  // Deferred so a slow or unreachable database does not delay readiness.
  const { startBootServers, loadAuthPolicy, startSchedulerTimer, startStatusBoardLoop, startDiscordChatBot, startLocalHeartbeatTimer, startUptimeTrackerTimer, startIdleDetectorTimer, startFileTransferServer } = await import("./instrumentation-node");

  // The FTP/FTPS listener for large uploads. Boot-time only: it re-reads its
  // settings whenever the operator saves them.
  //
  // Deliberately above the auto-start guard: file transfer is a panel service
  // rather than a game server, so silencing game-server boot on a staging copy
  // must not quietly take FTP down with it. Its own switch is GSM_DISABLE_FTP.
  void startFileTransferServer();

  if (process.env.GSM_DISABLE_AUTOSTART === "true") return;
  // Auth settings are cheap and needed by the first request.
  void loadAuthPolicy();
  // Scheduled tasks, live status boards and the chat bot fire on server-side
  // timers / a gateway connection, not from dashboard polls.
  void startSchedulerTimer();
  void startStatusBoardLoop();
  void startDiscordChatBot();
  // The panel's own machine heartbeats like any remote node, so its metrics
  // history and online state are never empty.
  void startLocalHeartbeatTimer();
    startUptimeTrackerTimer();
    startIdleDetectorTimer();
  setTimeout(() => {
    void startBootServers();
  }, 5_000);
}

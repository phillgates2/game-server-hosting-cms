/**
 * Local node heartbeat.
 *
 * Remote nodes prove they are alive by heartbeating through the agent; the
 * panel's own machine had no equivalent, so its metrics history and online
 * state were always empty. This loop writes the same node_metrics rows for
 * the local node, using the same collection the agent uses.
 */

const TICK_MS = 15_000;
let timer: NodeJS.Timeout | null = null;

async function sampleLocal(): Promise<{
  cpuPercent: number;
  cpuLoad1: number;
  cpuLoad5: number;
  cpuLoad15: number;
  ramUsedMb: number;
  ramTotalMb: number;
  diskUsedMb: number;
  diskTotalMb: number;
} | null> {
  const os = await import("node:os");
  const { readFile } = await import("node:fs/promises");
  const { statfs } = await import("node:fs/promises");

  const load = os.loadavg();
  const cores = Math.max(1, os.cpus().length);

  let ramUsedMb = 0;
  let ramTotalMb = 0;
  try {
    const meminfo = await readFile("/proc/meminfo", "utf8");
    const kb = (key: string) => {
      const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? Number.parseInt(m[1], 10) : 0;
    };
    ramTotalMb = Math.round(kb("MemTotal") / 1024);
    ramUsedMb = Math.round((kb("MemTotal") - kb("MemAvailable")) / 1024);
  } catch {
    return null; // no procfs, no metrics
  }

  let diskUsedMb = 0;
  let diskTotalMb = 0;
  try {
    const st = await statfs("/");
    diskTotalMb = Math.round((st.blocks * st.bsize) / (1024 * 1024));
    diskUsedMb = Math.max(0, diskTotalMb - Math.round((st.bavail * st.bsize) / (1024 * 1024)));
  } catch {
    /* disk optional */
  }

  return {
    cpuPercent: Math.min(100, (load[0] / cores) * 100),
    cpuLoad1: load[0],
    cpuLoad5: load[1],
    cpuLoad15: load[2],
    ramUsedMb,
    ramTotalMb,
    diskUsedMb,
    diskTotalMb,
  };
}

async function tick(): Promise<void> {
  try {
    const { db } = await import("@/db");
    const { nodes, nodeMetrics } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [local] = await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.isLocal, true)).limit(1);
    if (!local) return; // no local node row yet

    const sample = await sampleLocal();
    if (!sample) return;

    await db.insert(nodeMetrics).values({ nodeId: local.id, ...sample });
    await db
      .update(nodes)
      .set({ status: "online", lastHeartbeat: new Date(), updatedAt: new Date() })
      .where(eq(nodes.id, local.id));
  } catch {
    // Fresh install (no tables yet) and transient failures must not be fatal.
  }
}

/** Start the loop (idempotent). Returns a stop handle. */
export function startLocalHeartbeat(): () => void {
  if (timer) return () => stopLocalHeartbeat();
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  return () => stopLocalHeartbeat();
}

export function stopLocalHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

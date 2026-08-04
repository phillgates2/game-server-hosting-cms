export interface PanelServerLike {
  id: number;
  status: string;
  name?: string;
  gameName?: string | null;
  nodeName?: string | null;
}

export interface PanelServerGroup<T extends PanelServerLike> {
  nodeName: string;
  nodeId: number | null;
  servers: T[];
}

export function sortServersForPanel<T extends PanelServerLike>(servers: T[]): T[] {
  const priority = {
    running: 0,
    installing: 1,
    install_failed: 2,
    stopped: 3,
  } as const;

  return [...servers].sort((a, b) => {
    const pa = priority[a.status as keyof typeof priority] ?? 99;
    const pb = priority[b.status as keyof typeof priority] ?? 99;

    if (pa !== pb) return pa - pb;
    return (a.name || "").localeCompare(b.name || "");
  });
}

export function summarizeServerStatus<T extends PanelServerLike>(servers: T[]) {
  return servers.reduce(
    (acc, server) => {
      const key = server.status in acc ? server.status : "stopped";
      acc[key as keyof typeof acc] += 1;
      return acc;
    },
    { running: 0, stopped: 0, installing: 0, install_failed: 0 } as Record<string, number>
  );
}

export function groupServersByNode<T extends PanelServerLike & { nodeId?: number | null }>(servers: T[]): PanelServerGroup<T>[] {
  const groups = new Map<string, PanelServerGroup<T>>();

  for (const server of servers) {
    const nodeName = server.nodeName?.trim() || "Unassigned";
    const nodeId = server.nodeId ?? null;
    const key = `${nodeId ?? "none"}:${nodeName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.servers.push(server);
      continue;
    }

    groups.set(key, { nodeName, nodeId, servers: [server] });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.nodeName === "Unassigned" && b.nodeName !== "Unassigned") return 1;
    if (b.nodeName === "Unassigned" && a.nodeName !== "Unassigned") return -1;
    return a.nodeName.localeCompare(b.nodeName);
  }).map((group) => ({
    ...group,
    servers: sortServersForPanel(group.servers),
  }));
}

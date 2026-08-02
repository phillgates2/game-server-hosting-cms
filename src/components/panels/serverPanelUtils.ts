export interface PanelServerLike {
  id: number;
  status: string;
  name?: string;
  gameName?: string | null;
  nodeName?: string | null;
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

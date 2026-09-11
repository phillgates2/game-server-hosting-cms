/**
 * Panel → remote node agent RPC client.
 *
 * The node agent (agent/gsm-agent.mjs) runs on each remote machine and
 * executes process-control commands there; this client is how the panel
 * reaches it, using the node row's stored API URL + API key. Fetch is
 * injectable so the transport is unit-testable without a network.
 */

export interface NodeEndpoint {
  apiUrl: string;
  apiKey: string;
}

export class NodeRpcError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export const DEFAULT_RPC_TIMEOUT_MS = 15_000;
/** Stops get their own grace period inside the agent; give them longer here. */
const STOP_TIMEOUT_MS = 30_000;

/** Join the node's API URL with an RPC path, tolerating trailing slashes. */
export function rpcUrl(apiUrl: string, path: string): string {
  return `${apiUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * POST a JSON payload to the agent and return the parsed response.
 * Throws NodeRpcError (with the agent's message when it sent one) on any
 * non-2xx answer, timeout, or connection failure.
 */
export async function nodeRpc<T = Record<string, unknown>>(
  node: NodeEndpoint,
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<T> {
  if (!node.apiUrl || !node.apiKey) {
    throw new NodeRpcError("Node has no API URL/key configured");
  }
  const doFetch = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;

  let res: Response;
  try {
    res = await doFetch(rpcUrl(node.apiUrl, path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": node.apiKey,
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    throw new NodeRpcError(
      aborted
        ? `Node agent did not answer within ${Math.round(timeoutMs / 1000)}s`
        : `Cannot reach the node agent (${e instanceof Error ? e.message : String(e)})`
    );
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error page; fall through to the status message */
  }

  if (!res.ok) {
    const msg = typeof data.error === "string" && data.error ? data.error : `Agent answered HTTP ${res.status}`;
    throw new NodeRpcError(msg, res.status);
  }
  return data as T;
}

// ── Typed helpers used by the panel routes ──────────────────────────────────

export interface RemoteProcessStatus {
  alive: boolean;
  pid: number | null;
}

export async function remoteProcessStatus(
  node: NodeEndpoint,
  installPath: string,
  pid: number | null
): Promise<RemoteProcessStatus> {
  return nodeRpc<RemoteProcessStatus>(node, "/rpc/process", { action: "status", installPath, pid });
}

export async function remoteProcessStart(
  node: NodeEndpoint,
  installPath: string
): Promise<{ pid: number | null; alive: boolean }> {
  return nodeRpc(node, "/rpc/process", { action: "start", installPath });
}

export async function remoteProcessStop(
  node: NodeEndpoint,
  installPath: string,
  pid: number | null
): Promise<{ ok: boolean; escalated?: boolean; alreadyStopped?: boolean }> {
  return nodeRpc(node, "/rpc/process", { action: "stop", installPath, pid }, { timeoutMs: STOP_TIMEOUT_MS });
}

export async function remoteLogTail(
  node: NodeEndpoint,
  installPath: string,
  tail: number
): Promise<string> {
  const data = await nodeRpc<{ log?: string }>(node, "/rpc/log", { installPath, tail });
  return typeof data.log === "string" ? data.log : "";
}

export async function pingNodeAgent(node: NodeEndpoint): Promise<{ hostname?: string; version?: string }> {
  return nodeRpc(node, "/rpc/ping", {}, { timeoutMs: 8_000 });
}

// ── Remote file operations ──────────────────────────────────────────────────

export interface RemoteFileItem {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
  ext: string | null;
}

export async function remoteFs<T = Record<string, unknown>>(
  node: NodeEndpoint,
  op: string,
  body: Record<string, unknown>
): Promise<T> {
  return nodeRpc<T>(node, "/rpc/fs", { op, ...body }, { timeoutMs: 30_000 });
}

export async function remoteFsList(node: NodeEndpoint, installPath: string, path: string): Promise<{ type: string; path: string; items: RemoteFileItem[] }> {
  return remoteFs(node, "list", { installPath, path });
}

export async function remoteFsRead(node: NodeEndpoint, installPath: string, path: string): Promise<Record<string, unknown>> {
  return remoteFs(node, "read", { installPath, path });
}

// ── Remote backups ──────────────────────────────────────────────────────────

export async function remoteBackupCreate(node: NodeEndpoint, installPath: string): Promise<{ ok: boolean; name: string }> {
  return nodeRpc(node, "/rpc/backup", { action: "create", installPath }, { timeoutMs: 600_000 });
}

export async function remoteBackupList(
  node: NodeEndpoint,
  installPath: string
): Promise<{ backups: Array<{ name: string; sizeMb: number; created: string }> }> {
  return nodeRpc(node, "/rpc/backup", { action: "list", installPath });
}

export async function remoteBackupRestore(node: NodeEndpoint, installPath: string, name: string): Promise<{ ok: boolean }> {
  return nodeRpc(node, "/rpc/backup", { action: "restore", installPath, name }, { timeoutMs: 600_000 });
}

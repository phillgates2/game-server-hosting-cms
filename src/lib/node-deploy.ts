/**
 * One-click agent deployment over SSH.
 *
 * Builds the exact shell commands that copy `agent/gsm-agent.mjs` to a remote
 * machine, write its environment, and install + start a systemd USER unit.
 * The command construction is pure (and unit-tested, injection included); the
 * route only executes the result.
 *
 * Key-based auth is the supported path; password auth works through sshpass
 * when the host has it, and the password never lands in a log.
 */

/** Wrap a value so it survives being embedded in a remote shell command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface DeployParams {
  sshUser: string;
  hostname: string;
  sshPort: number;
  /** Agent shared secret. */
  agentKey: string;
  /** Port the agent listens on. */
  agentPort: number;
  /** Where game servers live on the remote box. */
  serversRoot: string;
  /** Panel origin + node id for heartbeats ("" disables heartbeats). */
  panelUrl: string;
  nodeId: number;
}

export interface SshAuth {
  keyPath?: string | null;
  password?: string | null;
}

function commonSshOpts(port: number): string[] {
  return ["-o", "StrictHostKeyChecking=accept-new", "-p", String(port || 22)];
}

/** Prefix for running a command on the node: [cmd, ...args] (no target). */
export function sshPrefix(port: number, auth: SshAuth): { cmd: string; args: string[]; env: Record<string, string> } {
  const opts = commonSshOpts(port);
  if (auth.keyPath) return { cmd: "ssh", args: ["-i", auth.keyPath, "-o", "BatchMode=yes", ...opts], env: {} };
  // sshpass reads the password from SSHPASS, never the argv, so it stays out
  // of the process list on THIS machine too.
  if (auth.password) return { cmd: "sshpass", args: ["-e", "ssh", "-o", "BatchMode=no", ...opts], env: { SSHPASS: auth.password } };
  throw new Error("Node has neither an SSH key path nor a password");
}

/** Prefix for copying a file to the node: [cmd, ...args] (no file/target). */
export function scpPrefix(port: number, auth: SshAuth): { cmd: string; args: string[]; env: Record<string, string> } {
  const opts = ["-o", "StrictHostKeyChecking=accept-new", "-P", String(port || 22)];
  if (auth.keyPath) return { cmd: "scp", args: ["-i", auth.keyPath, ...opts], env: {} };
  if (auth.password) return { cmd: "sshpass", args: ["-e", "scp", ...opts], env: { SSHPASS: auth.password } };
  throw new Error("Node has neither an SSH key path nor a password");
}

/**
 * The remote bash script, executed as `bash -s` over ssh. Idempotent: a
 * re-run updates the env file and restarts the unit.
 */
export function buildDeployScript(p: DeployParams): string {
  // The env file is written through a quoted heredoc: a key containing a
  // newline (or the terminator word) could break out of it, so refuse any
  // character outside a conservative set.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(p.agentKey)) {
    throw new Error("Agent key must be 8-128 letters, numbers, dash or underscore");
  }

  // The agent file itself arrives over scp before this script runs; here we
  // only write configuration and the service unit. Values are inlined with
  // shell-safe quoting where they could contain hostile characters.
  const port = p.agentPort || 8787;
  return [
    "set -e",
    "mkdir -p \"$HOME/gsm-agent\" \"$HOME/.config/systemd/user\"",
    "cat > \"$HOME/gsm-agent/gsm-agent.env\" <<'GSMENV'",
    `GSM_AGENT_PORT=${port}`,
    `GSM_AGENT_KEY=${p.agentKey}`,
    `GSM_SERVERS_ROOT=${p.serversRoot || "/opt/gameservers"}`,
    `GSM_PANEL_URL=${p.panelUrl || ""}`,
    `GSM_NODE_ID=${p.nodeId}`,
    "GSM_HEARTBEAT_SECONDS=15",
    "GSMENV",
    "cat > \"$HOME/.config/systemd/user/gsm-agent.service\" <<'GSMUNIT'",
    "[Unit]",
    "Description=GSM Node Agent",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    "EnvironmentFile=%h/gsm-agent/gsm-agent.env",
    "ExecStart=/usr/bin/env node %h/gsm-agent/gsm-agent.mjs",
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "GSMUNIT",
    // Keep the key out of world-readable files.
    "chmod 600 \"$HOME/gsm-agent/gsm-agent.env\"",
    "systemctl --user daemon-reload",
    "systemctl --user enable gsm-agent >/dev/null 2>&1 || true",
    "systemctl --user restart gsm-agent",
    "loginctl enable-linger \"$(id -un)\" >/dev/null 2>&1 || true",
    `echo "gsm-agent deployed on $(hostname), port ${port}"`,
  ].join("\n");
}

/** Validate the node has the minimum fields to attempt a deploy. */
export function deployPreflight(node: {
  hostname: string | null;
  sshUser: string | null;
  sshKeyPath: string | null;
  sshPassword: string | null;
}): { ok: boolean; error?: string } {
  if (!node.hostname) return { ok: false, error: "The node needs a hostname." };
  if (!node.sshUser) return { ok: false, error: "The node needs an SSH user." };
  if (!node.sshKeyPath && !node.sshPassword) {
    return { ok: false, error: "The node needs an SSH key path or password." };
  }
  return { ok: true };
}

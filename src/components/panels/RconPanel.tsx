"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface AuthUser { id: number; username: string; role: string }

interface Server {
  id: number;
  name: string;
  status: string;
  gameName: string | null;
  gameIcon: string | null;
  gameSlug: string | null;
}

interface RconInfo {
  server: string;
  game: string;
  gameIcon: string;
  host: string;
  port: number;
  protocol: string;
  status: string;
}

interface HistoryEntry {
  type: "command" | "response" | "error" | "info";
  text: string;
  timestamp: string;
  duration?: number;
}

export default function RconPanel({ user }: { user: AuthUser }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [rconInfo, setRconInfo] = useState<RconInfo | null>(null);
  const [command, setCommand] = useState("");
  const [rconPassword, setRconPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState(-1);
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadServers = useCallback(async () => {
    try {
      const res = await fetch("/api/servers");
      if (res.ok) {
        const data = await res.json();
        setServers((data.servers || []).filter((s: Server) => s.status === "running"));
      }
    } catch { /* ignore */ } finally { setLoaded(true); }
  }, []);

  useEffect(() => { loadServers(); }, [loadServers]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [history]);

  async function selectServer(id: number) {
    setSelectedServerId(id);
    setHistory([]);
    setRconInfo(null);

    try {
      const res = await fetch(`/api/servers/${id}/rcon`);
      if (res.ok) {
        const info = await res.json();
        setRconInfo(info);
        addHistory("info", `Connected to ${info.server} (${info.game}) — ${info.protocol.toUpperCase()} protocol @ ${info.host}:${info.port}`);
        if (info.status !== "running") {
          addHistory("error", "⚠️ Server is not running. RCON commands may fail.");
        }
      } else {
        const err = await res.json();
        addHistory("error", `Failed to load server info: ${err.error}`);
      }
    } catch (e) {
      addHistory("error", `Connection error: ${e instanceof Error ? e.message : "Unknown"}`);
    }
  }

  function addHistory(type: HistoryEntry["type"], text: string, duration?: number) {
    setHistory((h) => [...h, { type, text, timestamp: new Date().toLocaleTimeString(), duration }]);
  }

  async function sendCommand(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim() || !selectedServerId) return;

    const cmd = command.trim();
    setCommand("");
    setCmdHistory((h) => [cmd, ...h].slice(0, 100));
    setCmdHistoryIdx(-1);
    addHistory("command", cmd);
    setSending(true);

    try {
      const res = await fetch(`/api/servers/${selectedServerId}/rcon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, password: rconPassword || undefined }),
      });
      const data = await res.json();

      if (data.success) {
        if (data.response) {
          addHistory("response", data.response, data.duration);
        } else {
          addHistory("info", `Command sent (${data.duration}ms, no response)`, data.duration);
        }
      } else {
        addHistory("error", data.error || "Command failed", data.duration);
      }
    } catch (e) {
      addHistory("error", `Network error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const next = Math.min(cmdHistoryIdx + 1, cmdHistory.length - 1);
        setCmdHistoryIdx(next);
        setCommand(cmdHistory[next]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdHistoryIdx > 0) {
        const next = cmdHistoryIdx - 1;
        setCmdHistoryIdx(next);
        setCommand(cmdHistory[next]);
      } else {
        setCmdHistoryIdx(-1);
        setCommand("");
      }
    }
  }

  // Quick command buttons per game
  const quickCommands: Record<string, string[]> = {
    "cs2":            ["status", "changelevel de_dust2", "mp_restartgame 1", "users", "bot_add", "bot_kick"],
    "tf2":            ["status", "changelevel cp_badlands", "mp_restartgame 1", "users", "sv_cheats 0"],
    "gmod":           ["status", "changelevel gm_flatgrass", "ulx help", "lua_run print('hello')"],
    "rust":           ["status", "server.save", "server.writecfg", "playerlist", "server.fps", "env.time"],
    "minecraft-java": ["list", "say Hello!", "tp @a 0 100 0", "time set day", "weather clear", "save-all"],
    "minecraft-paper":["list", "say Hello!", "tp @a 0 100 0", "time set day", "tps", "save-all"],
    "valheim":        ["info", "kick", "ban", "save"],
    "ark":            ["listplayers", "saveworld", "settimeofday 12:00", "broadcast Hello"],
    "7dtd":           ["listplayers", "say Hello", "settime day", "saveworld", "shutdown"],
    "palworld":       ["ShowPlayers", "Save", "Broadcast Hello", "KickPlayer", "BanPlayer"],
    "terraria":       ["/playing", "/save", "/time day", "/say Hello", "/kick", "/ban"],
    "wolfenstein-et": ["status", "map_restart", "rcon say Hello", "kick all"],
    "quake-live":     ["status", "map_restart", "say Hello"],
  };

  const gameSlug = servers.find((s) => s.id === selectedServerId)?.gameSlug || "";
  const commands = quickCommands[gameSlug] || ["status", "help"];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h2 className="text-2xl font-bold">🖥️ RCON Console</h2>
        <p className="text-text-secondary text-sm">Send remote commands to your game servers</p>
      </div>

      {/* Server selector */}
      <div className="flex gap-4 flex-wrap items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-text-muted mb-1">Select Server</label>
          <select
            value={selectedServerId || ""}
            onChange={(e) => e.target.value && selectServer(Number(e.target.value))}
            className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
          >
            <option value="">Choose a running server...</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.gameIcon} {s.name} ({s.gameName})
              </option>
            ))}
          </select>
        </div>
        <div className="w-64">
          <label className="block text-xs text-text-muted mb-1">
            RCON Password
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="ml-2 text-accent">
              {showPassword ? "hide" : "show"}
            </button>
          </label>
          <input
            type={showPassword ? "text" : "password"}
            value={rconPassword}
            onChange={(e) => setRconPassword(e.target.value)}
            placeholder="Leave blank to use saved password"
            className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
          />
        </div>
      </div>

      {/* No running servers */}
      {loaded && servers.length === 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
          <span className="text-4xl block mb-2">🖥️</span>
          <p className="text-text-secondary">No running servers. Start a server first to use RCON.</p>
        </div>
      )}

      {/* Server info bar */}
      {rconInfo && (
        <div className="bg-bg-secondary rounded-lg px-4 py-2 flex items-center gap-4 text-xs text-text-muted flex-wrap">
          <span>{rconInfo.gameIcon} {rconInfo.game}</span>
          <span className="font-mono">{rconInfo.host}:{rconInfo.port}</span>
          <span className="px-2 py-0.5 bg-accent/15 text-accent rounded">{rconInfo.protocol.toUpperCase()}</span>
          <span className={rconInfo.status === "running" ? "text-success" : "text-danger"}>
            {rconInfo.status === "running" ? "● Online" : "● Offline"}
          </span>
        </div>
      )}

      {/* Terminal */}
      {selectedServerId && (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          {/* Terminal output */}
          <div
            ref={terminalRef}
            className="h-96 overflow-y-auto p-4 font-mono text-xs leading-relaxed bg-[#0d1117]"
            onClick={() => inputRef.current?.focus()}
          >
            {history.length === 0 && (
              <div className="text-text-muted">Type a command below and press Enter. Use ↑/↓ for command history.</div>
            )}
            {history.map((entry, i) => (
              <div key={i} className="flex gap-2 py-0.5">
                <span className="text-text-muted flex-shrink-0 w-16">{entry.timestamp}</span>
                {entry.type === "command" && (
                  <span><span className="text-success">❯</span> <span className="text-text-primary">{entry.text}</span></span>
                )}
                {entry.type === "response" && (
                  <span className="text-sky-400 whitespace-pre-wrap">{entry.text}</span>
                )}
                {entry.type === "error" && (
                  <span className="text-danger">{entry.text}</span>
                )}
                {entry.type === "info" && (
                  <span className="text-text-muted italic">{entry.text}</span>
                )}
                {entry.duration !== undefined && (
                  <span className="text-text-muted ml-auto flex-shrink-0">{entry.duration}ms</span>
                )}
              </div>
            ))}
            {sending && (
              <div className="text-accent animate-pulse py-0.5">⏳ Sending command...</div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={sendCommand} className="border-t border-border flex items-center bg-[#0d1117]">
            <span className="text-success font-mono text-sm pl-4 pr-2">❯</span>
            <input
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={sending ? "Sending..." : "Enter command..."}
              disabled={sending}
              className="flex-1 py-3 bg-transparent text-text-primary font-mono text-sm focus:outline-none disabled:opacity-50"
              autoComplete="off"
              autoFocus
            />
            <button type="submit" disabled={sending || !command.trim()} className="px-4 py-3 text-accent hover:text-accent-hover disabled:opacity-30 text-sm font-medium">
              Send
            </button>
          </form>
        </div>
      )}

      {/* Quick commands */}
      {selectedServerId && (
        <div>
          <h3 className="text-sm font-medium text-text-muted mb-2">Quick Commands</h3>
          <div className="flex gap-2 flex-wrap">
            {commands.map((cmd) => (
              <button
                key={cmd}
                onClick={() => { setCommand(cmd); inputRef.current?.focus(); }}
                className="px-3 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs font-mono hover:border-accent/30 hover:text-accent transition-colors"
              >
                {cmd}
              </button>
            ))}
            <button
              onClick={() => { setHistory([]); }}
              className="px-3 py-1.5 bg-danger/10 text-danger rounded-lg text-xs font-medium hover:bg-danger/20 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

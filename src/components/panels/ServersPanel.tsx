"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm, useConfirmChoice } from "@/components/ConfirmDialog";
import { groupServersByNode, sortServersForPanel, summarizeServerStatus } from "./serverPanelUtils";
import MetricsChart from "@/components/MetricsChart";
import type { MetricPoint } from "@/lib/metrics-history";
import { mergePresetVariables } from "@/lib/server-presets";
import { recommendNodeId, nodeWarnings, nodeLoadLabel, type NodeLoad } from "@/lib/node-health";
import { tagsFromInput, sortTags } from "@/lib/server-tags";
import { connectInfoFor } from "@/lib/connect-info";

interface AuthUser { id: number; username: string; role: string }
interface GameDef { id: number; name: string; slug: string; defaultPort: number; iconEmoji: string | null }
interface PresetInfo { id: number; name: string; description: string | null; gameId: number; variables: Record<string, string>; gameName: string | null; gameIcon: string | null; mine: boolean }
interface NodeInfo { id: number; name: string; hostname: string; status: string; isDefault: boolean | null; isLocal: boolean | null; gameServerPath: string | null; serverCount?: number; metrics?: NodeLoad | null; maintenanceMode?: boolean | null }
interface TemplateVar {
  name: string; description: string; env_variable: string; default_value: string;
  user_viewable: boolean; user_editable: boolean; rules: string; field_type: string;
  enum_values?: Record<string, string>; category?: string;
}
interface Collaborator { id: number; userId: number; email: string | null; role: string; createdAt: string }
interface BlueprintEntry { presetId: number; count: number; namePattern: string | null }
interface BlueprintInfo { id: number; name: string; description: string | null; entries: BlueprintEntry[]; mine: boolean }

interface Server {
  id: number; name: string; userId: number | null; sharedWithMe?: boolean; playerAlertThreshold: number | null; ipv4: string | null; ipv6: string | null; port: number;
  status: string; gameName: string | null; gameSlug: string | null; gameIcon: string | null;
  nodeName: string | null; nodeId: number | null; autoRestart: boolean | null; autoStart: boolean | null;
  discordWebhook: string | null; discordNotifyPlayers: boolean | null; statusPublic: boolean | null; pid: number | null; lastStarted: string | null; createdAt: string;
  notes: string | null;
  tags: string[] | null;
  expiresAt: string | null;
}

const STATUS_MAP: Record<string, { label: string; dot: string; bg: string }> = {
  running:        { label: "Running",        dot: "bg-success",    bg: "bg-success/10 border-success/30" },
  stopped:        { label: "Stopped",        dot: "bg-text-muted", bg: "bg-bg-secondary border-border" },
  installing:     { label: "Installing",     dot: "bg-accent",     bg: "bg-accent/10 border-accent/30" },
  install_failed: { label: "Install Failed", dot: "bg-danger",     bg: "bg-danger/10 border-danger/30" },
};

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "server";
}

export default function ServersPanel({ user }: { user: AuthUser }) {
  const toast = useToast();
  const confirm = useConfirm();
  const confirmChoice = useConfirmChoice();

  const [servers, setServers] = useState<Server[]>([]);
  const [games, setGames] = useState<GameDef[]>([]);
  const [nodeList, setNodeList] = useState<NodeInfo[]>([]);
  const [wizard, setWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [form, setForm] = useState({ name: "", gameId: "", nodeId: "", port: "", ipv4: "0.0.0.0", ipv6: "", installPath: "", discordWebhook: "" });
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped" | "installing" | "install_failed">("all");
  const [installLog, setInstallLog] = useState<{ output: string; error: string; success: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [gameVars, setGameVars] = useState<TemplateVar[]>([]);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [varSearch, setVarSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [consoleId, setConsoleId] = useState<number | null>(null);
  const [consoleLog, setConsoleLog] = useState("");
  const [consoleInfo, setConsoleInfo] = useState<{ status: string; pid: number | null; lines: number; fileSizeKb: number } | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  // Uptime tick
  const [, setTick] = useState(0);
  // Migration
  const [migrateId, setMigrateId] = useState<number | null>(null);
  const [migrateTarget, setMigrateTarget] = useState("");
  const [migratingId, setMigratingId] = useState<number | null>(null);

  // Metrics chart (per-server CPU/RAM history)
  const [metricsId, setMetricsId] = useState<number | null>(null);
  const [metricsRange, setMetricsRange] = useState(6);
  const [metrics, setMetrics] = useState<{ cpu: MetricPoint[]; ram: MetricPoint[]; samples: number; dirMb: number | null; disk: { usedMb: number; totalMb: number } | null; events: Array<{ kind: string; detail: string | null; createdAt: string }> } | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [roster, setRoster] = useState<{ players: number | null; names: string[]; maxPlayers: number | null; map: string | null; reachable: boolean } | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [heatmap, setHeatmap] = useState<{ cells: Array<{ day: number; hour: number; avg: number; samples: number }>; peakLabel: string | null; samples: number } | null>(null);
  // Server notes (free-form operator annotations)
  const [notesId, setNotesId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState<"start" | "stop" | "restart" | "update" | null>(null);
  const [collabs, setCollabs] = useState<Record<number, Collaborator[] | null>>({});
  const [collabBusy, setCollabBusy] = useState<number | null>(null);
  const [collabEmail, setCollabEmail] = useState("");
  const [collabRoleSel, setCollabRoleSel] = useState<"viewer" | "operator">("viewer");
  const [blueprintsOpen, setBlueprintsOpen] = useState(false);
  const [blueprints, setBlueprints] = useState<BlueprintInfo[]>([]);
  const [bpName, setBpName] = useState("");
  const [bpEntries, setBpEntries] = useState<BlueprintEntry[]>([]);
  const [bpDeployNode, setBpDeployNode] = useState<number | 0>(0);
  const [bpBusy, setBpBusy] = useState<number | "save" | null>(null);
  const [alertDrafts, setAlertDrafts] = useState<Record<number, string>>({});
  const [dailyRestart, setDailyRestart] = useState<{ scheduled: boolean; enabled: boolean; hour: number; minute: number } | null>(null);
  const [dailyRestartBusy, setDailyRestartBusy] = useState(false);
  const [dailyBackup, setDailyBackup] = useState<{ scheduled: boolean; enabled: boolean; hour: number; minute: number } | null>(null);
  const [dailyBackupBusy, setDailyBackupBusy] = useState(false);
  const [serverChanges, setServerChanges] = useState<Array<{ field: string; from: string; to: string; at: string; by: string | null }> | null>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  // Public status share link
  const [shareId, setShareId] = useState<number | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [srvR, gameR, nodeR] = await Promise.allSettled([fetch("/api/servers"), fetch("/api/games"), fetch("/api/nodes")]);
      const failures: string[] = [];
      if (srvR.status === "fulfilled" && srvR.value.ok) {
        setServers((await srvR.value.json()).servers || []);
      } else {
        failures.push("servers");
      }
      if (gameR.status === "fulfilled" && gameR.value.ok) {
        setGames((await gameR.value.json()).games || []);
      } else {
        failures.push("games");
      }
      if (nodeR.status === "fulfilled" && nodeR.value.ok) {
        const nodes = ((await nodeR.value.json()).nodes || []) as NodeInfo[];
        const online = nodes.filter((n) => n.status === "online");
        setNodeList(online);
        const def = online.find((n) => n.isDefault);
        if (def) setForm((f) => ({ ...f, nodeId: String(def.id) }));
      } else {
        failures.push("nodes");
      }
      if (failures.length > 0) {
        setLoadError("Some server data could not be refreshed. Check your connection or permissions and try again.");
      }
    } catch {
      setLoadError("The server list could not be refreshed. Please try again in a moment.");
      fetch("/api/presets").then(async (r) => { if (r.ok) setPresets((await r.json()).presets || []); }).catch(() => undefined);
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  // Auto-refresh: poll running servers every 15s to detect crashes
  useEffect(() => {
    const interval = setInterval(async () => {
      const running = servers.filter((s) => s.status === "running");
      if (running.length === 0) return;
      let changed = false;
      for (const srv of running) {
        try {
          const res = await fetch(`/api/servers/${srv.id}/process`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "status" }),
          });
          if (res.ok) {
            const data = await res.json();
            if (!data.alive && srv.status === "running") {
              toast.warning("Server Crashed", `${srv.name} is no longer running.`);
              changed = true;
            }
          }
        } catch { /**/ }
      }
      if (changed) loadData();
    }, 15000);
    return () => clearInterval(interval);
  }, [servers, loadData, toast]);

  // Uptime ticker — re-render every 30s to update uptime displays
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  async function onGameChange(gameId: string) {
    const game = games.find((g) => g.id === Number(gameId));
    if (game) {
      setForm((f) => ({ ...f, gameId, port: String(game.defaultPort) }));
      try {
        const res = await fetch(`/api/games/${game.id}/variables`);
        if (res.ok) {
          const data = await res.json();
          const vars: TemplateVar[] = data.variables || [];
          setGameVars(vars.filter((v) => v.user_viewable));
          const skip = new Set(["SERVER_NAME", "PORT", "INSTALL_PATH", "QUERY_PORT"]);
          const defs: Record<string, string> = {};
          for (const v of vars) { if (!skip.has(v.env_variable) && v.default_value) defs[v.env_variable] = v.default_value; }
          setVarValues(defs);
          return vars;
        }
      } catch { setGameVars([]); }
    } else { setForm((f) => ({ ...f, gameId })); setGameVars([]); setVarValues({}); }
    setVarSearch("");
    setOpenGroups({});
  }

  function exportPresets() {
    if (presets.length === 0) return;
    const payload = {
      app: "game-server-manager",
      kind: "server-presets",
      exportedAt: new Date().toISOString(),
      presets: presets.map(({ gameName, gameIcon, mine, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gsm-server-presets.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importPresetsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>).presets
          : null;
      const res = await fetch("/api/presets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presets: list ?? [] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Import failed", data?.error || "Could not import presets"); return; }
      toast.success("Presets imported", `${data.imported} added${data.skippedUnknownGame ? `, ${data.skippedUnknownGame} skipped (game not installed here)` : ""}.`);
      const refresh = await fetch("/api/presets");
      if (refresh.ok) setPresets((await refresh.json()).presets || []);
    } catch {
      toast.error("Import failed", "That file is not valid preset JSON.");
    }
  }

  async function applyPreset(preset: PresetInfo) {
    setError("");
    const vars = await onGameChange(String(preset.gameId));
    if (!vars) { toast.error("Preset", `The game for preset "${preset.name}" is no longer available.`); return; }
    const declared = new Set(vars.map((v) => v.env_variable));
    setVarValues((v) => mergePresetVariables(v, preset.variables, declared));
    setForm((f) => {
      const next = { ...f };
      const sn = preset.variables.SERVER_NAME;
      if (sn && sn.trim()) next.name = sn.trim();
      const pt = preset.variables.PORT;
      if (pt && /^\d{2,5}$/.test(pt)) next.port = pt;
      return next;
    });
    setWizardStep(1);
  }

  async function saveAsPreset() {
    if (!presetName.trim() || !form.gameId) return;
    setSavingPreset(true);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: presetName.trim(), gameId: Number(form.gameId), variables: varValues }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Could not save preset");
      }
      toast.success("Preset saved", "Pick it on the first wizard step next time.");
      setSavePresetOpen(false);
      setPresetName("");
      void fetch("/api/presets").then(async (r) => { if (r.ok) setPresets((await r.json()).presets || []); }).catch(() => undefined);
    } catch (e: unknown) {
      toast.error("Save preset failed", e instanceof Error ? e.message : "Could not save preset");
    } finally {
      setSavingPreset(false);
    }
  }

  async function createServer(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch("/api/servers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, variables: varValues }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); toast.error("Create Failed", data.error); }
      else {
        setWizard(false);
        setWizardStep(0);
        toast.success(
          "Server Created",
          `"${form.name}" is ready. Folder: ${data.server?.installPath || installPathPreview}. Click Install Files to download game files.`
        );
        loadData();
      }
    } catch (e) { const msg = e instanceof Error ? e.message : "Failed"; setError(msg); toast.error("Error", msg); } finally { setLoading(false); }
  }

  async function savePlayerAlert(id: number, disable = false) {
    const draft = (alertDrafts[id] ?? "").trim();
    const num = Number(draft);
    if (!disable && (!Number.isInteger(num) || num < 1 || num > 1000)) {
      toast.error("Player alert", "Threshold must be a whole number between 1 and 1000.");
      return;
    }
    const value = disable ? null : num;
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerAlertThreshold: disable ? null : value }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Player alert", disable ? "Alert disabled." : `You'll be notified when this server reaches ${value} players.`);
        setAlertDrafts((d) => ({ ...d, [id]: "" }));
        loadData();
      } else toast.error("Player alert", data?.error || "Could not save the threshold");
    } catch (e) { toast.error("Player alert", e instanceof Error ? e.message : "Network error"); }
  }

  async function loadBlueprints() {
    try {
      const res = await fetch("/api/blueprints");
      const data = await res.json().catch(() => null);
      if (res.ok) setBlueprints(data?.blueprints ?? []);
    } catch { /* panel keeps working */ }
  }

  function openBlueprints() {
    const next = !blueprintsOpen;
    setBlueprintsOpen(next);
    if (next) {
      void loadBlueprints();
      if (bpDeployNode === 0 && nodeList.length > 0) {
        const def = nodeList.find((n) => n.isDefault) ?? nodeList[0];
        setBpDeployNode(def.id);
      }
    }
  }

  async function saveBlueprint() {
    if (!bpName.trim() || bpEntries.length === 0 || bpBusy !== null) return;
    setBpBusy("save");
    try {
      const res = await fetch("/api/blueprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bpName.trim(),
          entries: bpEntries.map((e) => ({ presetId: e.presetId, count: e.count, namePattern: e.namePattern?.trim() || null })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Blueprint saved", `"${bpName.trim()}" is ready to deploy.`); setBpName(""); setBpEntries([]); void loadBlueprints(); }
      else toast.error("Blueprint rejected", data?.error || "Invalid blueprint");
    } catch (e) { toast.error("Blueprint failed", e instanceof Error ? e.message : "Network error"); }
    finally { setBpBusy(null); }
  }

  async function deleteBlueprint(id: number) {
    if (bpBusy !== null) return;
    setBpBusy(id);
    try {
      const res = await fetch(`/api/blueprints/${id}`, { method: "DELETE" });
      if (res.ok) void loadBlueprints();
      else toast.error("Delete failed", "Could not delete the blueprint");
    } finally { setBpBusy(null); }
  }

  async function deployBlueprint(id: number) {
    if (bpBusy !== null || !bpDeployNode) return;
    const bp = blueprints.find((b) => b.id === id);
    const total = bp ? bp.entries.reduce((n, e) => n + e.count, 0) : 0;
    const ok = await confirm({
      title: "Deploy blueprint",
      message: `Deploy "${bp?.name ?? "blueprint"}"? This creates ${total} new server${total === 1 ? "" : "s"} on the selected node (quota and port rules still apply).`,
      confirmLabel: `Deploy ${total}`,
    });
    if (!ok) return;
    setBpBusy(id);
    try {
      const res = await fetch(`/api/blueprints/${id}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: bpDeployNode }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Blueprint deployed", `${data?.created ?? 0}/${data?.planned ?? total} servers created${data?.failed ? ` (${data.failed} failed)` : ""}.`);
        loadData();
      } else {
        toast.error("Deploy failed", data?.error || "The blueprint could not be deployed");
      }
    } catch (e) { toast.error("Deploy failed", e instanceof Error ? e.message : "Network error"); }
    finally { setBpBusy(null); }
  }

  async function loadCollabs(id: number) {
    setCollabs((c) => ({ ...c, [id]: c[id] ?? [] }));
    try {
      const res = await fetch(`/api/servers/${id}/collaborators`);
      const data = await res.json().catch(() => null);
      if (res.ok) setCollabs((c) => ({ ...c, [id]: data?.collaborators ?? [] }));
      else setCollabs((c) => ({ ...c, [id]: [] }));
    } catch { setCollabs((c) => ({ ...c, [id]: [] })); }
  }

  async function addCollab(id: number) {
    const email = collabEmail.trim();
    if (!email || collabBusy) return;
    setCollabBusy(id);
    try {
      const res = await fetch(`/api/servers/${id}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: collabRoleSel }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Shared", `${email} can now access this server as ${collabRoleSel}.`); setCollabEmail(""); void loadCollabs(id); }
      else toast.error("Share failed", data?.error || "Could not add collaborator");
    } catch (e) { toast.error("Share failed", e instanceof Error ? e.message : "Network error"); }
    finally { setCollabBusy(null); }
  }

  async function setCollabRole(id: number, userId: number, role: "viewer" | "operator") {
    if (collabBusy) return;
    setCollabBusy(id);
    try {
      const res = await fetch(`/api/servers/${id}/collaborators`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) void loadCollabs(id);
      else toast.error("Update failed", data?.error || "Could not change role");
    } finally { setCollabBusy(null); }
  }

  async function removeCollab(id: number, userId: number, label: string) {
    if (collabBusy) return;
    setCollabBusy(id);
    try {
      const res = await fetch(`/api/servers/${id}/collaborators`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Access removed", `${label} can no longer access this server.`); void loadCollabs(id); }
      else toast.error("Remove failed", data?.error || "Could not remove collaborator");
    } finally { setCollabBusy(null); }
  }

  async function batchUpdate(staged = false) {
    const ids = filteredServers.map((srv) => srv.id);
    if (ids.length === 0 || batchBusy) return;
    const stoppedCount = filteredServers.filter((srv) => srv.status === "stopped").length;
    const ok = await confirm({
      title: staged ? "Staged rollout" : "Batch update",
      message: staged
        ? `Update ${stoppedCount} stopped server${stoppedCount === 1 ? "" : "s"} as a staged rollout? The FIRST one is updated and boot-verified; only if it survives does the rest of the batch follow. A bad canary halts the rollout and leaves the fleet untouched.`
        : `Update ${ids.length} server${ids.length === 1 ? "" : "s"} via Steam? ${stoppedCount} stopped server${stoppedCount === 1 ? "" : "s"} will be updated (each gets its pre-update backup); running/installing ones are skipped.`,
      confirmLabel: staged ? `Staged rollout (${stoppedCount})` : `Update ${ids.length}`,
    });
    if (!ok) return;
    setBatchBusy("update");
    try {
      const res = await fetch("/api/servers/batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverIds: ids, staged }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Batch update", data?.error || "The batch update was rejected"); return; }
      const skipped = (data?.skippedIds?.length ?? 0) + (data?.results?.filter((r: { skipped?: string }) => r.skipped).length ?? 0);
      if (staged && data?.halted) {
        toast.error("Rollout halted at the canary", data.summary || `Canary failed — the other ${data?.results?.length ?? 0} servers were not touched.`);
      } else if ((data?.failed ?? 0) > 0) {
        toast.warning(staged ? "Staged rollout finished with errors" : "Batch update finished with errors", `${data.ok} updated, ${data.failed} failed${skipped ? `, ${skipped} skipped` : ""}.`);
      } else {
        toast.success(staged ? "Staged rollout done" : "Batch update done", `${data?.ok ?? 0} updated${skipped ? `, ${skipped} skipped (running/installing)` : ""}.`);
      }
      loadData();
    } catch (e) {
      toast.error("Batch update", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBatchBusy(null);
    }
  }

  async function cloneWithTtl(id: number, ttlHours: number) {
    const srv = servers.find((s) => s.id === id);
    const ok = await confirm({ title: "Ephemeral Clone", message: `Clone "${srv?.name || "this server"}" as a temporary test server? It will be STOPPED and DELETED automatically after ${ttlHours} hours. You still need to run Install Files on the clone.`, confirmLabel: `Clone for ${ttlHours}h`, danger: false });
    if (!ok) return;
    try {
      const res = await fetch(`/api/servers/${id}/clone`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ttlHours }) });
      const data = await res.json();
      if (!res.ok) { toast.error("Clone Failed", data.error); return; }
      toast.success("Ephemeral Clone Created", `${data.server?.name || "Clone"} — auto-deletes in ${ttlHours}h. Run Install Files on it next.`);
      loadData();
    } catch (e) { toast.error("Error", e instanceof Error ? e.message : "Failed"); }
  }

  async function copyConnect(server: Server) {
    const info = connectInfoFor(server.gameSlug, server.ipv4, server.ipv6, server.port);
    if (!info.connect) { toast.error("Connect", info.hint); return; }
    try {
      await navigator.clipboard.writeText(info.connect);
      toast.success("Connect info copied", `${info.connect} — ${info.hint}`);
    } catch {
      toast.error("Connect", info.connect);
    }
  }

  async function batchAction(action: "start" | "stop" | "restart", rolling = false) {
    const ids = filteredServers.map((srv) => srv.id);
    if (ids.length === 0 || batchBusy) return;
    const verb = action === "start" ? "Start" : action === "stop" ? "Stop" : "Restart";
    const scope = hasActiveFilters
      ? `${ids.length} filtered server${ids.length === 1 ? "" : "s"}`
      : `ALL ${ids.length} servers (no filters are active!)`;
    const runningCount = filteredServers.filter((srv) => srv.status === "running").length;
    const ok = await confirm({
      title: rolling ? "Rolling restart" : `Batch ${verb}`,
      message: rolling
        ? `Rolling-restart ${runningCount} running server${runningCount === 1 ? "" : "s"}? They restart ONE AT A TIME and each must come back up before the next is touched. If one fails to return, the sweep halts and the rest stay untouched.`
        : `${verb} ${scope}? Each server keeps its own safety rails (crash-loop breaker, remote dispatch, notifications).`,
      confirmLabel: rolling ? `Roll ${runningCount}` : `${verb} ${ids.length}`,
      danger: action === "stop",
    });
    if (!ok) return;
    setBatchBusy(action);
    try {
      const res = await fetch("/api/servers/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, serverIds: ids, rolling }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Batch failed", data?.error || "The batch request was rejected"); return; }
      const skipped = data?.skippedIds?.length ? `, ${data.skippedIds.length} skipped` : "";
      if (rolling && data?.haltedAt) {
        toast.error("Rolling restart halted", data.summary || `"${data.haltedAt}" did not come back — remaining servers untouched.`);
      } else if ((data?.failed ?? 0) > 0) {
        toast.warning("Batch finished with errors", `${data.ok} succeeded, ${data.failed} failed${skipped}.`);
      } else {
        toast.success(rolling ? "Rolling restart done" : `Batch ${action} done`, `${data?.ok ?? 0} server${(data?.ok ?? 0) === 1 ? "" : "s"} OK${skipped}.`);
      }
      loadData();
    } catch (e) {
      toast.error("Batch failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBatchBusy(null);
    }
  }

  async function controlProcess(id: number, action: "start" | "stop" | "restart") {
    const srv = servers.find((s) => s.id === id);
    if (action === "stop" || action === "restart") {
      const ok = await confirm({ title: `${action === "stop" ? "Stop" : "Restart"} Server`, message: `Are you sure you want to ${action} "${srv?.name || "this server"}"?`, confirmLabel: action === "stop" ? "Stop Server" : "Restart Server", danger: action === "stop" });
      if (!ok) return;
    }
    try {
      const res = await fetch(`/api/servers/${id}/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok) { toast.error(`${action} Failed`, data.error); }
      else if (action === "start" && !data.alive) { toast.error("Server Crashed", "Process started but exited immediately. Open Console to see why."); }
      else { toast.success(action === "start" ? "▶ Started" : action === "stop" ? "⏹ Stopped" : "🔄 Restarted", `PID: ${data.pid || "—"}`); }
      loadData();
    } catch (e) { toast.error("Error", e instanceof Error ? e.message : "Failed"); }
  }

  async function deleteServer(id: number) {
    const srv = servers.find((s) => s.id === id);
    const result = await confirmChoice({
      title: "Delete Server",
      message: `Choose how to delete "${srv?.name}". This action cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
      choices: [
        {
          value: "db",
          label: "Delete DB record only",
          description: "Keeps the server files/folders on disk.",
        },
        {
          value: "all",
          label: "Delete DB record + server files",
          description: "Removes the assigned install folder too (recommended for local nodes).",
        },
      ],
      defaultChoice: "all",
    });
    if (!result.confirmed) return;

    const res = await fetch(`/api/servers/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteMode: result.choice }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      toast.error("Delete Failed", data.error || "Could not delete server.");
      return;
    }

    if (result.choice === "db") {
      toast.info("Server Deleted", `${srv?.name || "Server"} record removed. Files were kept.`);
    } else if (data.filesDeleted) {
      toast.success("Server Deleted", `${srv?.name || "Server"} and its assigned folder were removed.`);
    } else {
      toast.warning(
        "Server Deleted",
        `${srv?.name || "Server"} record removed, but file deletion was skipped. ${data.filesDeleteSkippedReason || ""}`.trim()
      );
    }

    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    loadData();
  }

  /** Flip autoRestart / autoStart. Optimistic, reverted if the PATCH fails. */
  async function toggleServerFlag(id: number, field: "autoRestart" | "autoStart" | "discordNotifyPlayers" | "statusPublic", next: boolean) {
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: next } : s)));
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Update failed");
    } catch (e: unknown) {
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: !next } : s)));
      toast.error("Could not save", e instanceof Error ? e.message : "Please try again.");
    }
  }

  async function cloneServer(id: number) {
    const srv = servers.find((s) => s.id === id);
    const ok = await confirm({ title: "Clone Server", message: `Create a copy of "${srv?.name}" with a new port? You'll need to run Install Files on the clone.`, confirmLabel: "Clone" });
    if (!ok) return;
    try {
      const res = await fetch(`/api/servers/${id}/clone`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) toast.error("Clone Failed", data.error);
      else { toast.success("Server Cloned", data.message); loadData(); }
    } catch (e) { toast.error("Error", e instanceof Error ? e.message : "Failed"); }
  }

  async function updateServer(id: number) {
    const srv = servers.find((s) => s.id === id);
    if (srv?.status === "running") { toast.warning("Stop First", "Stop the server before updating."); return; }
    const ok = await confirm({ title: "Update Server", message: `Re-run SteamCMD app_update for "${srv?.name}"? This downloads the latest version. A backup is created first (can be turned off in Settings → Panel).`, confirmLabel: "Update" });
    if (!ok) return;
    try {
      const res = await fetch(`/api/servers/${id}/update`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast.error("Update Failed", data.error); }
      else {
        toast.success("Updated", data.message);
        const cfg = data?.report?.configsChanged;
        if (Array.isArray(cfg) && cfg.length > 0) {
          toast.warning("Config files changed", `The game update touched ${cfg.length} config file(s): ${cfg.slice(0, 3).join(", ")}${cfg.length > 3 ? "…" : ""}. Check them before starting the server.`);
        }
      }
      loadData();
    } catch (e) { toast.error("Error", e instanceof Error ? e.message : "Failed"); }
  }

  async function drillBackup(id: number) {
    const srv = servers.find((s) => s.id === id);
    const ok = await confirm({ title: "Restore Drill", message: `Test-restore the newest backup of "${srv?.name}" into a scratch folder? The live server is not touched; this proves your backup actually restores.`, confirmLabel: "Run Drill" });
    if (!ok) return;
    toast.success("Drill running", "Extracting the newest backup into a scratch folder…");
    try {
      const res = await fetch(`/api/servers/${id}/backup-drill`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error("Drill failed", data?.error || data?.reason || "The backup could not be restored.");
      } else {
        toast.success("Backup verified ✅", `${data.backupName}: ${data.reason} in ${(data.tookMs / 1000).toFixed(1)}s.`);
      }
      loadData();
    } catch (e) {
      toast.error("Drill failed", e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function backupServer(id: number) {
    const srv = servers.find((s) => s.id === id);
    const ok = await confirm({ title: "Create Backup", message: `Create a backup archive for "${srv?.name}"? This may take a few minutes for large servers.`, confirmLabel: "Backup Now" });
    if (!ok) return;
    try {
      const res = await fetch(`/api/servers/${id}/backup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
      const data = await res.json();
      if (!res.ok) toast.error("Backup Failed", data.error);
      else toast.success("Backup Created", data.message);
    } catch (e) { toast.error("Error", e instanceof Error ? e.message : "Failed"); }
  }

  async function loadMetrics(id: number, hours: number) {
    setMetricsLoading(true);
    setMetrics(null);
    try {
      const res = await fetch(`/api/servers/${id}/metrics?hours=${hours}`);
      const data = await res.json();
      if (!res.ok) { toast.error("Metrics", data.error || "Could not load metrics"); return; }
      setMetrics({ cpu: data.cpu || [], ram: data.ram || [], samples: data.samples || 0, dirMb: data.dirMb ?? null, disk: data.disk ?? null, events: data.events || [] });
    } catch { toast.error("Metrics", "Network error"); }
    finally { setMetricsLoading(false); }
  }

  async function loadRoster(id: number) {
    setRosterBusy(true);
    try {
      const res = await fetch(`/api/servers/${id}/roster`);
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Roster", data?.error || "Could not probe the roster"); return; }
      setRoster(data);
    } catch {
      toast.error("Roster", "Network error");
    } finally {
      setRosterBusy(false);
    }
  }

  async function loadHeatmap(id: number) {
    try {
      const res = await fetch(`/api/servers/${id}/player-history`);
      if (res.ok) setHeatmap(await res.json());
    } catch { /* the charts still work without it */ }
  }

  function toggleMetrics(id: number) {
    if (metricsId === id) { setMetricsId(null); setMetrics(null); setRoster(null); setHeatmap(null); return; }
    setMetricsId(id);
    setRoster(null);
    setHeatmap(null);
    void loadHeatmap(id);
    void loadMetrics(id, metricsRange);
  }

  function changeMetricsRange(hours: number) {
    setMetricsRange(hours);
    if (metricsId !== null) void loadMetrics(metricsId, hours);
  }

  async function createShareLink(id: number) {
    const srv = servers.find((s) => s.id === id);
    setShareBusy(true);
    try {
      const res = await fetch(`/api/servers/${id}/status-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast.error("Share Link", data.error || "Could not create the link"); return; }
      setShareId(id);
      setShareUrl(`${window.location.origin}${data.url}`);
      toast.success("Share Link Created", `Anyone with the link can see the status of "${srv?.name}". Creating a new link replaces the old one.`);
    } catch { toast.error("Share Link", "Network error"); }
    finally { setShareBusy(false); }
  }

  async function revokeShareLink(id: number) {
    setShareBusy(true);
    try {
      const res = await fetch(`/api/servers/${id}/status-link`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error("Share Link", d.error || "Could not revoke the link"); return; }
      setShareId(null);
      setShareUrl("");
      toast.success("Share Link Revoked", "The old link no longer works.");
    } catch { toast.error("Share Link", "Network error"); }
    finally { setShareBusy(false); }
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Copied", "Status link copied to clipboard.");
    } catch { toast.error("Copy Failed", "Select and copy the link manually."); }
  }

  async function installServerFiles(id: number) {
    const srv = servers.find((s) => s.id === id);
    const ok = await confirm({ title: "Install Game Files", message: `Download and install game files for "${srv?.name}"? This may take several minutes.`, confirmLabel: "Install Files" });
    if (!ok) return;
    setInstallingId(id); setInstallLog(null);
    try {
      const res = await fetch(`/api/servers/${id}/install`, { method: "POST" }); const data = await res.json();
      if (!res.ok) { setInstallLog({ output: data.output || "", error: data.error || data.errorOutput || "Install failed", success: false }); toast.error("Install Failed", data.error || "Check the install log for details."); }
      else { setInstallLog({ output: data.output || "", error: data.errorOutput || "", success: true }); toast.success("Files Installed", "Game files are ready. You can now Start the server."); }
      loadData();
    } catch (e) { toast.error("Install Error", e instanceof Error ? e.message : "Failed"); } finally { setInstallingId(null); }
  }

  // ── Bulk actions ──
  function toggleSelect(id: number) { setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function toggleSelectAll() { if (selected.size === servers.length) setSelected(new Set()); else setSelected(new Set(servers.map((s) => s.id))); }

  async function bulkAction(action: "start" | "stop" | "restart" | "install" | "backup") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const label = action === "start" ? "Start" : action === "stop" ? "Stop" : action === "restart" ? "Restart" : action === "backup" ? "Back up" : "Install Files on";
    const ok = await confirm({ title: `Bulk ${label}`, message: `${label} ${ids.length} server${ids.length > 1 ? "s" : ""}?`, confirmLabel: `${label} All`, danger: action === "stop" });
    if (!ok) return;
    setBulkLoading(true);
    let successCount = 0;
    for (const id of ids) {
      try {
        if (action === "install") {
          const res = await fetch(`/api/servers/${id}/install`, { method: "POST" });
          if (res.ok) successCount++;
        } else if (action === "backup") {
          const res = await fetch(`/api/servers/${id}/backup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
          if (res.ok) successCount++;
        } else {
          const res = await fetch(`/api/servers/${id}/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
          if (res.ok) successCount++;
        }
      } catch { /**/ }
    }
    toast.success("Bulk Action Complete", `${successCount}/${ids.length} servers processed.`);
    setSelected(new Set());
    setBulkLoading(false);
    loadData();
  }

  async function migrateServer(id: number) {
    const destId = Number(migrateTarget);
    if (!destId) { toast.error("Migrate", "Pick a destination node first."); return; }
    const dest = nodeList.find((n) => n.id === destId);
    const srv = servers.find((x) => x.id === id);
    const ok = await confirm({ title: "Migrate Server", message: `Move "${srv?.name}" to node "${dest?.name}"? The server must be stopped; its files are archived on the source, transferred, and unpacked on the destination.`, confirmLabel: "Migrate" });
    if (!ok) return;
    setMigratingId(id);
    try {
      const res = await fetch(`/api/servers/${id}/migrate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodeId: destId }) });
      const data = await res.json();
      if (!res.ok) toast.error("Migration Failed", data.error || "Could not migrate the server.");
      else { toast.success("Server Moved", data.message); setMigrateId(null); setMigrateTarget(""); loadData(); }
    } catch (e) { toast.error("Migration Failed", e instanceof Error ? e.message : "Network error"); }
    finally { setMigratingId(null); }
  }

  // ── Notes ──
  function openNotes(server: Server) {
    if (notesId === server.id) { setNotesId(null); return; }
    setNotesId(server.id);
    setNotesDraft(server.notes || "");
    setTagsDraft(sortTags(server.tags).join(", "));
    setDailyRestart(null);
    fetch(`/api/servers/${server.id}/daily-restart`)
      .then(async (r) => { if (r.ok) setDailyRestart(await r.json()); })
      .catch(() => undefined);
    setDailyBackup(null);
    fetch(`/api/servers/${server.id}/daily-backup`)
      .then(async (r) => { if (r.ok) setDailyBackup(await r.json()); })
      .catch(() => undefined);
    setServerChanges(null);
    fetch(`/api/servers/${server.id}/changes`)
      .then(async (r) => { if (r.ok) setServerChanges((await r.json()).changes || []); })
      .catch(() => undefined);
  }

  async function setDailyBackupSchedule(id: number, enabled: boolean, hour: number, minute: number) {
    setDailyBackupBusy(true);
    try {
      const res = await fetch(`/api/servers/${id}/daily-backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, hour, minute }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Daily backup", data?.error || "Could not update the schedule"); return; }
      setDailyBackup({ scheduled: !!data.scheduled, enabled: !!data.scheduled, hour, minute });
      toast.success("Daily backup", enabled ? `Every day at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}.` : "Scheduled backup disabled.");
    } catch {
      toast.error("Daily backup", "Could not update the schedule");
    } finally {
      setDailyBackupBusy(false);
    }
  }

  async function setDailyRestartSchedule(id: number, enabled: boolean, hour: number, minute: number) {
    setDailyRestartBusy(true);
    try {
      const res = await fetch(`/api/servers/${id}/daily-restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, hour, minute }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Daily restart", data?.error || "Could not update the schedule"); return; }
      setDailyRestart({ scheduled: !!data.scheduled, enabled: !!data.scheduled, hour, minute });
      toast.success("Daily restart", enabled ? `Every day at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}.` : "Scheduled restart disabled.");
    } catch {
      toast.error("Daily restart", "Could not update the schedule");
    } finally {
      setDailyRestartBusy(false);
    }
  }

  async function saveServerDetails(id: number) {
    const tags = tagsFromInput(tagsDraft);
    if (!tags.ok) { toast.error("Tags", tags.error || "Invalid tags"); return; }
    setNotesSaving(true);
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft, tags: tags.value ?? [] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error("Server details", data?.error || "Could not save");
        return;
      }
      const storedNotes = notesDraft.trim() || null;
      const storedTags = tags.value ?? [];
      setServers((list) => list.map((srv) => (srv.id === id ? { ...srv, notes: storedNotes, tags: storedTags } : srv)));
      toast.success("Saved", "Notes and tags updated.");
      setNotesId(null);
    } catch {
      toast.error("Server details", "Could not save");
    } finally {
      setNotesSaving(false);
    }
  }

  // ── Console ──
  const fetchLog = useCallback(async (id: number) => {
    try {
      const d = await (await fetch(`/api/servers/${id}/log?tail=300`)).json();
      setConsoleLog(d.log || d.message || "");
      setConsoleInfo({ status: d.status, pid: d.pid, lines: d.lines || 0, fileSizeKb: d.fileSizeKb || 0 });
      setTimeout(() => { consoleRef.current && (consoleRef.current.scrollTop = consoleRef.current.scrollHeight); }, 50);
    } catch { /**/ }
  }, []);

  async function openConsole(id: number) { setConsoleId(id); await fetchLog(id); }
  useEffect(() => {
    if (consoleId === null) return;
    const i = window.setInterval(() => {
      void fetchLog(consoleId);
    }, 3000);
    return () => window.clearInterval(i);
  }, [consoleId, fetchLog]);

  const selectedGame = games.find((g) => g.id === Number(form.gameId));
  const selectedNode = nodeList.find((n) => n.id === Number(form.nodeId));
  const onlineNodes = nodeList;
  // Snapshot time once per mount — Date.now() during render trips react-hooks/purity.
  const [pickerNow] = useState(() => Date.now());
  const nodeCandidates = onlineNodes.map((n) => ({ id: n.id, online: true, load: n.metrics ?? null, serverCount: n.serverCount ?? 0, maintenance: !!n.maintenanceMode }));
  const recommendedNodeId = recommendNodeId(nodeCandidates, pickerNow);
  const selectedNodeWarnings = selectedNode
    ? nodeWarnings({ id: selectedNode.id, online: true, load: selectedNode.metrics ?? null, serverCount: selectedNode.serverCount ?? 0 }, pickerNow)
    : [];
  const allServerTags = Array.from(new Set(servers.flatMap((srv) => srv.tags ?? []))).sort();
  const canCreate = form.name && form.gameId && form.nodeId && form.port;
  const filteredServers = sortServersForPanel(
    servers.filter((server) => {
      const query = searchQuery.trim().toLowerCase();
      const matchesQuery = !query || [server.name, server.gameName, server.nodeName].filter(Boolean).some((value) => value!.toLowerCase().includes(query));
      const matchesStatus = statusFilter === "all" || server.status === statusFilter;
      const matchesTag = !tagFilter || (server.tags ?? []).includes(tagFilter);
      return matchesQuery && matchesStatus && matchesTag;
    })
  );
  const groupedServers = groupServersByNode(filteredServers);
  const serverSummary = summarizeServerStatus(servers);
  const allVisibleVars = gameVars.filter((v) => !["SERVER_NAME","PORT","INSTALL_PATH","QUERY_PORT"].includes(v.env_variable));
  // Templates now ship full option sets (Wolfenstein: ET alone has 150+), so the
  // wizard needs a filter to stay usable.
  const varQuery = varSearch.trim().toLowerCase();
  const visibleVars = varQuery
    ? allVisibleVars.filter((v) =>
        [v.name, v.env_variable, v.description, v.category].some((field) =>
          (field || "").toLowerCase().includes(varQuery)
        )
      )
    : allVisibleVars;
  // Group template variables by category (Server Identity / Network / Voting / ...)
  // so big option sets stay navigable.
  const varGroups = visibleVars.reduce<{ name: string; vars: TemplateVar[] }[]>((acc, v) => {
    const name = (v.category || "").trim() || "General";
    const last = acc[acc.length - 1];
    if (last && last.name === name) { last.vars.push(v); }
    else {
      const existing = acc.find((g) => g.name === name);
      if (existing) existing.vars.push(v);
      else acc.push({ name, vars: [v] });
    }
    return acc;
  }, []);
  const hasVarCategories = varGroups.some((g) => g.name !== "General") && varGroups.length > 1;
  function toggleGroup(name: string, open: boolean) {
    setOpenGroups((p) => ({ ...p, [name]: open }));
  }
  function setAllGroups(open: boolean) {
    setOpenGroups(Object.fromEntries(varGroups.map((g) => [g.name, open])));
  }
  // A search should reveal its matches rather than hide them behind collapsed groups.
  const groupsForceOpen = varQuery.length > 0;
  // Count how many options the user has changed away from the template default.
  const changedVarCount = allVisibleVars.filter((v) => {
    const current = varValues[v.env_variable];
    return current !== undefined && current !== "" && current !== v.default_value;
  }).length;
  const inputCls = "w-full px-3 py-2.5 gaming-chip rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-colors";
  // Stable across renders so VarField's props do not change identity on every
  // keystroke (which is what remounted the input and stole focus).
  const setVarValue = useCallback((envVariable: string, next: string) => {
    setVarValues((prev) => ({ ...prev, [envVariable]: next }));
  }, []);
  const hasActiveFilters = Boolean(searchQuery.trim()) || statusFilter !== "all";
  const installPathPreview = selectedNode && selectedGame && form.name
    ? `${selectedNode.gameServerPath || "/home/gameservers"}/${slugify(selectedGame.slug)}/${slugify(form.name)}`
    : (selectedNode?.gameServerPath || form.installPath || "");

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("all");
  }

  function setStatusQuickFilter(status: typeof statusFilter) {
    setStatusFilter((current) => current === status ? "all" : status);
  }

  function formatLastSeen(server: Server) {
    if (server.status === "running") {
      const uptime = formatUptime(server.lastStarted);
      return uptime ? `Up ${uptime}` : "Running";
    }
    return "Stopped";
  }

  return (
    <div className="animate-fade-in panel-view space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold">🎮 Game Servers</h2>
          <p className="text-text-secondary text-sm">{servers.length} server{servers.length !== 1 ? "s" : ""}{servers.filter((s) => s.status === "running").length > 0 ? ` · ${servers.filter((s) => s.status === "running").length} running` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setLoaded(false); void loadData(); }} className="px-3 py-2 border border-border bg-bg-card rounded-lg text-sm text-text-secondary hover:border-accent/30 hover:text-accent transition-colors">
            ↻ Refresh
          </button>
          <button onClick={() => { setWizard(!wizard); setWizardStep(0); setError(""); }} className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
            {wizard ? "✕ Cancel" : "+ Create Server"}
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={selected.size === servers.length} onChange={toggleSelectAll} className="rounded w-4 h-4 accent-accent" />
            <span className="text-sm font-medium">{selected.size} server{selected.size > 1 ? "s" : ""} selected</span>
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => bulkAction("start")} color="success" icon="▶" label="Start All" disabled={bulkLoading} />
            <Btn onClick={() => bulkAction("stop")} color="danger" icon="⏹" label="Stop All" disabled={bulkLoading} />
            <Btn onClick={() => bulkAction("restart")} color="warning" icon="🔄" label="Restart All" disabled={bulkLoading} />
            <Btn onClick={() => bulkAction("backup")} color="muted" icon="💾" label="Back Up All" disabled={bulkLoading} />
            <Btn onClick={() => bulkAction("install")} color="accent" icon="📥" label="Install All" disabled={bulkLoading} />
            <Btn onClick={() => setSelected(new Set())} color="muted" icon="✕" label="Clear" />
          </div>
        </div>
      )}

      {/* Warnings */}
      {loadError && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning flex flex-wrap items-center justify-between gap-3">
          <p>{loadError}</p>
          <button onClick={() => { setLoaded(false); void loadData(); }} className="rounded-lg border border-warning/30 bg-bg-card px-3 py-1.5 text-xs font-medium text-warning">Retry</button>
        </div>
      )}
      {onlineNodes.length === 0 && loaded && <Notice icon="🖥️" text="No online nodes. Go to Nodes and add a Local Node first." />}
      {games.length === 0 && loaded && <Notice icon="📦" text="No games installed. Go to Games → Templates to install one." />}

      {/* ═══ CREATE WIZARD ═══ */}
      {wizard && onlineNodes.length > 0 && games.length > 0 && (
        <div className="gaming-surface border-accent/30 rounded-xl overflow-hidden shadow-lg">
          <div className="flex border-b border-border">
            {["① Basics", "② Game Settings", "③ Confirm"].map((label, i) => (
              <button key={i} onClick={() => i <= wizardStep && setWizardStep(i)} className={`flex-1 py-3 text-xs font-medium transition-colors ${i === wizardStep ? "bg-accent/10 text-accent border-b-2 border-accent" : i < wizardStep ? "text-success bg-success/5" : "text-text-muted"}`}>{i < wizardStep ? `✓ ${label.slice(2)}` : label}</button>
            ))}
          </div>
          <form onSubmit={createServer} className="p-6">
            {wizardStep === 0 && (
              <div className="space-y-5">
                <p className="text-text-secondary text-sm">Choose a game, name your server, and pick a node.</p>
                <div className="flex items-center justify-end gap-2 mb-3 mt-2">
                  <button type="button" onClick={exportPresets} disabled={presets.length === 0} title="Download your presets as a shareable JSON file" className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-bg-secondary text-text-secondary hover:border-accent/40 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors">⬆️ Export presets</button>
                  <label title="Load presets from a shared JSON file" className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-bg-secondary text-text-secondary hover:border-accent/40 hover:text-accent transition-colors cursor-pointer">
                    ⬇️ Import presets
                    <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => void importPresetsFile(e)} />
                  </label>
                </div>
                {presets.length > 0 && (
                  <div className="mb-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Quick start — your presets</p>
                    <div style={{ display: "grid", gap: 8 }}>
                      {presets.map((p) => (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, background: "var(--bg-secondary)", cursor: "pointer", border: "1px solid var(--border-color)", transition: "border-color 0.15s" }}
                          onClick={() => void applyPreset(p)}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-color)")}
                        >
                          <span style={{ fontSize: 22 }}>{p.gameIcon || "🎮"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 600 }}>{p.name}</p>
                            <p style={{ margin: 0, fontSize: 12, color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.gameName}{p.description ? ` — ${p.description}` : ""}</p>
                          </div>
                          {(p.mine || user.role === "admin") && (
                            <span className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); void fetch(`/api/presets/${p.id}`, { method: "DELETE" }).then((r) => { if (r.ok) setPresets((list) => list.filter((x) => x.id !== p.id)); }); }}>🗑</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-text-muted" style={{ fontSize: 11, marginTop: 6 }}>Click a preset to apply its game and settings instantly.</p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Game *</label><select value={form.gameId} onChange={(e) => onGameChange(e.target.value)} className={inputCls} required><option value="">Choose a game...</option>{games.map((g) => <option key={g.id} value={g.id}>{g.iconEmoji} {g.name}</option>)}</select></div>
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Server Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required placeholder="My Server" /></div>
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Node *</label><select value={form.nodeId} onChange={(e) => setForm({ ...form, nodeId: e.target.value })} className={inputCls} required><option value="">Choose a node...</option>{onlineNodes.map((n) => {
                    const loadLbl = nodeLoadLabel(n.metrics ?? null);
                    return <option key={n.id} value={n.id}>{n.name}{n.isDefault ? " ★" : ""}{n.maintenanceMode ? " 🔧" : ""}{loadLbl ? ` — ${loadLbl}` : ""}{n.id === recommendedNodeId ? " ✨" : ""}</option>;
                  })}</select></div>
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Port *</label><input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} className={inputCls} required placeholder={selectedGame ? String(selectedGame.defaultPort) : "27015"} /><p className="text-[10px] text-text-muted mt-1">Default: {selectedGame?.defaultPort || "varies"}</p></div>
                </div>
                {(recommendedNodeId != null && onlineNodes.length > 1 && String(recommendedNodeId) !== form.nodeId) && (() => {
                  const rec = onlineNodes.find((n) => n.id === recommendedNodeId);
                  if (!rec) return null;
                  return (
                    <button type="button" onClick={() => setForm({ ...form, nodeId: String(rec.id) })} className="w-full text-left px-3 py-2 rounded-lg bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20 transition-colors">
                      ✨ {rec.name} currently looks the least loaded — click to use it
                    </button>
                  );
                })()}
                {selectedNodeWarnings.length > 0 && (
                  <p className="px-3 py-2 rounded-lg bg-warning/10 text-warning text-xs">⚠️ {selectedNode?.name}: {selectedNodeWarnings.join(" · ")}</p>
                )}
                {installPathPreview && (
                  <div className="bg-bg-secondary rounded-lg p-3 text-xs">
                    <p className="text-text-muted mb-1">Server folder preview</p>
                    <p className="font-mono text-text-primary break-all">{installPathPreview}</p>
                    <p className="text-text-muted mt-1">A unique folder is created for every new server automatically.</p>
                  </div>
                )}
                <div className="flex justify-end pt-2"><button type="button" disabled={!form.gameId || !form.name || !form.nodeId || !form.port} onClick={() => setWizardStep(1)} className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium">Next →</button></div>
              </div>
            )}
            {wizardStep === 1 && (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-text-secondary text-sm">Configure {selectedGame?.name || "game"} settings. Defaults are already filled in.</p>
                    <p className="text-text-muted text-xs mt-0.5">
                      {allVisibleVars.length} option{allVisibleVars.length !== 1 ? "s" : ""} available
                      {changedVarCount > 0 ? ` · ${changedVarCount} changed` : ""}
                    </p>
                  </div>
                  {allVisibleVars.length > 8 && (
                    <div className="flex items-center gap-2">
                      <input
                        type="search"
                        value={varSearch}
                        onChange={(e) => setVarSearch(e.target.value)}
                        placeholder="Search settings…"
                        className="px-3 py-2 gaming-chip rounded-lg text-sm w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                      {hasVarCategories && (
                        <>
                          <button type="button" onClick={() => setAllGroups(true)} className="px-2.5 py-2 gaming-chip rounded-lg text-xs whitespace-nowrap" title="Expand all groups">Expand</button>
                          <button type="button" onClick={() => setAllGroups(false)} className="px-2.5 py-2 gaming-chip rounded-lg text-xs whitespace-nowrap" title="Collapse all groups">Collapse</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {varQuery && (
                  <p className="text-xs text-text-muted">
                    {visibleVars.length} match{visibleVars.length !== 1 ? "es" : ""} for “{varSearch.trim()}”
                    {visibleVars.length === 0 ? " — try a different term." : ""}
                  </p>
                )}
                {visibleVars.length > 0 ? (
                  hasVarCategories ? (
                    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                      {varGroups.map((g, gi) => {
                        const isOpen = groupsForceOpen || (openGroups[g.name] ?? gi === 0);
                        return (
                          <details key={g.name} open={isOpen} onToggle={(e) => toggleGroup(g.name, (e.target as HTMLDetailsElement).open)} className="group rounded-xl border border-border bg-bg-secondary/40 overflow-hidden">
                            <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover/40 transition-colors list-none">
                              <span className="flex items-center gap-2">
                                <span className={`text-text-muted transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}>▸</span>
                                {g.name}
                              </span>
                              <span className="text-[11px] font-normal text-text-muted">{g.vars.length} option{g.vars.length !== 1 ? "s" : ""}</span>
                            </summary>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 p-4 border-t border-border">
                              {g.vars.map((v) => <VarField key={v.env_variable} v={v} value={varValues[v.env_variable] ?? v.default_value ?? ""} onChange={setVarValue} inputCls={inputCls} />)}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">{visibleVars.map((v) => <VarField key={v.env_variable} v={v} value={varValues[v.env_variable] ?? v.default_value ?? ""} onChange={setVarValue} inputCls={inputCls} />)}</div>
                  )
                ) : (<div className="bg-bg-secondary rounded-lg p-6 text-center text-text-muted text-sm">{varQuery ? "No settings match your search." : "No additional settings for this game."}</div>)}
                <div className="flex justify-between items-center pt-2 gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={() => setWizardStep(0)} className="px-5 py-2.5 gaming-chip rounded-lg text-sm font-medium">← Back</button>
                    {savePresetOpen ? (
                      <span className="flex items-center gap-2">
                        <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name…" className={inputCls} style={{ width: 180 }} maxLength={128} />
                        <button type="button" disabled={savingPreset || !presetName.trim()} onClick={() => void saveAsPreset()} className="px-3 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium">{savingPreset ? "Saving…" : "💾 Save"}</button>
                        <button type="button" onClick={() => setSavePresetOpen(false)} className="px-2 py-2 text-text-muted text-sm">✕</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setSavePresetOpen(true)} title="Save this configuration as a reusable preset" className="px-3 py-2.5 gaming-chip rounded-lg text-sm font-medium">💾 Save as preset</button>
                    )}
                  </div>
                  <button type="button" onClick={() => setWizardStep(2)} className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">Next →</button>
                </div>
              </div>
            )}
            {wizardStep === 2 && (
              <div className="space-y-5">
                <p className="text-text-secondary text-sm">Review before creating.</p>
                <div className="bg-bg-secondary rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-3 pb-3 border-b border-border"><span className="text-3xl">{selectedGame?.iconEmoji || "🎮"}</span><div><p className="font-bold text-lg">{form.name}</p><p className="text-text-secondary text-sm">{selectedGame?.name}</p></div></div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><p className="text-text-muted text-xs">Node</p><p>{onlineNodes.find((n) => n.id === Number(form.nodeId))?.name || "—"}</p></div>
                    <div><p className="text-text-muted text-xs">Port</p><p>{form.port}</p></div>
                    <div><p className="text-text-muted text-xs">IPv4</p><p>{form.ipv4 || "0.0.0.0"}</p></div>
                    <div><p className="text-text-muted text-xs">Path</p><p className="font-mono text-xs truncate">{installPathPreview || "(auto-generated)"}</p></div>
                  </div>
                  {Object.keys(varValues).length > 0 && (
                    <div className="pt-3 border-t border-border"><p className="text-text-muted text-xs mb-2">Game Settings ({Object.values(varValues).filter(Boolean).length})</p><div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">{Object.entries(varValues).filter(([,v]) => v).map(([k,v]) => { const def = gameVars.find((gv) => gv.env_variable === k); let display = v; if (def?.enum_values?.[v]) display = def.enum_values[v]; if (def?.field_type === "password" && v) display = "••••••"; return <div key={k} className="text-xs"><span className="text-text-muted">{def?.name || k}:</span> <span className="font-medium">{display}</span></div>; })}</div></div>
                  )}
                </div>
                {error && <p className="text-danger text-sm">❌ {error}</p>}
                <div className="flex justify-between pt-2"><button type="button" onClick={() => setWizardStep(1)} className="px-5 py-2.5 gaming-chip rounded-lg text-sm font-medium">← Back</button><button type="submit" disabled={loading || !canCreate} className="px-8 py-2.5 bg-success hover:opacity-90 disabled:opacity-40 text-white rounded-lg text-sm font-medium shadow-sm">{loading ? "Creating..." : "🚀 Create Server"}</button></div>
              </div>
            )}
          </form>
        </div>
      )}

      {/* ═══ CONSOLE ═══ */}
      {consoleId && (
        <div className="gaming-surface rounded-xl overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3"><h3 className="font-semibold text-sm">📋 Console</h3><span className="text-xs text-text-muted">{servers.find((s) => s.id === consoleId)?.name}</span>{consoleInfo && <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${consoleInfo.status === "running" ? "bg-success/15 text-success" : "bg-bg-tertiary text-text-muted"}`}>{consoleInfo.status}{consoleInfo.pid ? ` · PID ${consoleInfo.pid}` : ""}</span>}</div>
            <div className="flex gap-2"><button onClick={() => fetchLog(consoleId)} className="text-accent text-xs">↻</button><button onClick={() => setConsoleId(null)} className="text-text-muted text-xs">✕</button></div>
          </div>
          <div ref={consoleRef} className="h-80 overflow-y-auto p-4 bg-[#0d1117] font-mono text-xs leading-relaxed whitespace-pre-wrap text-text-secondary">{consoleLog || <span className="text-text-muted italic">No output yet. Start the server to see logs here.</span>}</div>
          <div className="px-5 py-2 border-t border-border text-[10px] text-text-muted flex justify-between"><span>↻ Auto-refresh 3s</span><span>gsm-server.log</span></div>
        </div>
      )}

      {/* ═══ INSTALL LOG ═══ */}
      {installLog && (
        <div className="gaming-surface rounded-xl overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3 border-b border-border flex items-center justify-between"><h3 className="font-semibold text-sm">{installLog.success ? "✅" : "⚠️"} Install Log</h3><button onClick={() => setInstallLog(null)} className="text-text-muted text-xs">✕</button></div>
          <div className="p-4 max-h-72 overflow-y-auto bg-[#0d1117] font-mono text-xs whitespace-pre-wrap leading-relaxed">{installLog.output && <div className="text-text-secondary">{installLog.output}</div>}{installLog.error && <div className="text-danger mt-2">{installLog.error}</div>}</div>
        </div>
      )}

      {/* ═══ LOADING ═══ */}
      {!loaded && <div className="text-center py-12"><div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}

      {/* ═══ EMPTY ═══ */}
      {loaded && servers.length === 0 && !wizard && (
        <div className="gaming-surface rounded-xl p-16 text-center">
          <span className="text-5xl block mb-4">🎮</span><h3 className="text-xl font-bold mb-2">No servers yet</h3>
          <p className="text-text-secondary mb-6 max-w-md mx-auto">Create your first game server. The wizard will guide you through choosing a game, settings, and installing files.</p>
          <button onClick={() => { setWizard(true); setWizardStep(0); }} className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium shadow-sm">+ Create Your First Server</button>
        </div>
      )}

      {/* ═══ SERVER LIST ═══ */}
      {servers.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg-card p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2 text-sm">
              <button onClick={clearFilters} className={`rounded-full px-3 py-1 transition-colors ${statusFilter === "all" ? "bg-accent text-white" : "bg-bg-secondary text-text-secondary hover:bg-bg-hover"}`}>
                All: {servers.length}
              </button>
              <button onClick={() => setStatusQuickFilter("running")} className={`rounded-full px-3 py-1 transition-colors ${statusFilter === "running" ? "bg-success text-white" : "bg-success/10 text-success hover:bg-success/20"}`}>
                Running: {serverSummary.running}
              </button>
              <button onClick={() => setStatusQuickFilter("installing")} className={`rounded-full px-3 py-1 transition-colors ${statusFilter === "installing" ? "bg-accent text-white" : "bg-accent/10 text-accent hover:bg-accent/20"}`}>
                Installing: {serverSummary.installing}
              </button>
              <button onClick={() => setStatusQuickFilter("install_failed")} className={`rounded-full px-3 py-1 transition-colors ${statusFilter === "install_failed" ? "bg-danger text-white" : "bg-danger/10 text-danger hover:bg-danger/20"}`}>
                Failed: {serverSummary.install_failed}
              </button>
              <button onClick={() => setStatusQuickFilter("stopped")} className={`rounded-full px-3 py-1 transition-colors ${statusFilter === "stopped" ? "bg-text-primary text-bg-card" : "bg-bg-secondary text-text-secondary hover:bg-bg-hover"}`}>
                Stopped: {serverSummary.stopped}
              </button>
              {allServerTags.length > 0 && (
                <span className="flex items-center gap-1 flex-wrap ml-1">
                  <span className="text-[10px] text-text-muted mr-0.5">Tags:</span>
                  {allServerTags.map((t) => (
                    <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)} className={`rounded-full px-2.5 py-1 text-xs transition-colors ${tagFilter === t ? "bg-accent text-white" : "bg-bg-secondary text-text-secondary hover:bg-bg-hover"}`}>#{t}</button>
                  ))}
                </span>
              )}
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium uppercase tracking-wider text-text-muted">Search servers</label>
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Name, game, node..." className="mt-1 w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div className="min-w-[180px]">
              <label className="text-xs font-medium uppercase tracking-wider text-text-muted">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="mt-1 w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40">
                <option value="all">All statuses</option>
                <option value="running">Running</option>
                <option value="stopped">Stopped</option>
                <option value="installing">Installing</option>
                <option value="install_failed">Install failed</option>
              </select>
            </div>
            <div className="flex items-end gap-3 text-sm text-text-secondary">
              <div>
                <p className="font-medium">{filteredServers.length} shown</p>
                <p className="text-xs text-text-muted">out of {servers.length} total</p>
              </div>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/30 hover:text-accent transition-colors">
                  Clear filters
                </button>
              )}
            </div>
          </div>
          {filteredServers.length >= 2 && (
            <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border bg-bg-secondary/50 px-3 py-2">
              <span className="text-xs text-text-secondary font-medium">⚡ Batch — {filteredServers.length} servers shown{hasActiveFilters ? "" : " (no filters)"}</span>
              <div className="ml-auto flex items-center gap-2">
                <Btn onClick={() => void batchAction("start")} color="success" icon="▶" label={batchBusy === "start" ? "Starting…" : "Start all"} disabled={batchBusy !== null} title="Start every server shown" />
                <Btn onClick={() => void batchAction("restart")} color="warning" icon="🔄" label={batchBusy === "restart" ? "Restarting…" : "Restart all"} disabled={batchBusy !== null} title="Restart every server shown" />
                <Btn onClick={() => void batchAction("restart", true)} color="warning" icon="🔁" label={batchBusy === "restart" ? "Rolling…" : "Rolling restart"} disabled={batchBusy !== null} title="Restart servers one at a time; each must come back up before the next is touched. Halts if one fails to return." />
                <Btn onClick={() => void batchAction("stop")} color="danger" icon="⏹" label={batchBusy === "stop" ? "Stopping…" : "Stop all"} disabled={batchBusy !== null} title="Stop every server shown" />
                <Btn onClick={() => void batchUpdate()} color="accent" icon="📥" label={batchBusy === "update" ? "Updating…" : "Update stopped"} disabled={batchBusy !== null} title="Steam-update every stopped server shown (running ones are skipped)" />
                <Btn onClick={() => void batchUpdate(true)} color="accent" icon="🪜" label={batchBusy === "update" ? "Rolling out…" : "Staged rollout"} disabled={batchBusy !== null} title="Update one canary first and boot-verify it; only then update the rest. Halts the whole rollout if the canary fails." />
                <Btn onClick={openBlueprints} color="warning" icon="🧬" label={blueprintsOpen ? "Close blueprints" : "Blueprints"} disabled={false} title="Multi-server deploy definitions built from your presets" />
              </div>
            </div>
          )}

          {/* ═══ BLUEPRINTS ═══ */}
          {blueprintsOpen && (
            <div className="space-y-3 rounded-xl border border-border bg-bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">🧬 Blueprints — one-click fleet deploys</h3>
                <button onClick={() => setBlueprintsOpen(false)} className="text-xs text-text-muted hover:text-text-primary">✕ close</button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-text-secondary">Deploy target node:</label>
                <select value={bpDeployNode} onChange={(e) => setBpDeployNode(Number(e.target.value))} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary">
                  {nodeList.map((n) => <option key={n.id} value={n.id}>{n.name}{n.maintenanceMode ? " (maintenance)" : ""}</option>)}
                </select>
              </div>
              {blueprints.length === 0 ? (
                <p className="text-xs text-text-muted">No blueprints yet — build one below from your presets.</p>
              ) : (
                <div className="space-y-1.5">
                  {blueprints.map((bp) => {
                    const total = bp.entries.reduce((n, e) => n + e.count, 0);
                    return (
                      <div key={bp.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-2">
                        <span className="flex-1 min-w-[160px] text-xs font-medium text-text-primary truncate">
                          {bp.name} <span className="text-text-muted font-normal">· {total} server{total === 1 ? "" : "s"}{bp.mine ? "" : " · shared"}</span>
                        </span>
                        <button
                          onClick={() => void deployBlueprint(bp.id)}
                          disabled={bpBusy !== null || !bpDeployNode}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                        >{bpBusy === bp.id ? "Deploying…" : "▶ Deploy"}</button>
                        {bp.mine ? (
                          <button
                            onClick={() => void deleteBlueprint(bp.id)}
                            disabled={bpBusy !== null}
                            title="Delete blueprint"
                            className="text-xs text-text-muted hover:text-danger disabled:opacity-40"
                          >✕</button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="space-y-2 border-t border-border pt-3">
                <h4 className="text-xs font-semibold text-text-secondary">New blueprint</h4>
                {presets.length === 0 ? (
                  <p className="text-xs text-text-muted">Blueprints deploy presets — save a preset from the create-server flow first.</p>
                ) : (
                  <>
                    <input
                      value={bpName}
                      onChange={(e) => setBpName(e.target.value)}
                      maxLength={128}
                      placeholder='Blueprint name, e.g. "Friday event night"'
                      className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted"
                    />
                    {bpEntries.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 flex-wrap">
                        <select
                          value={e.presetId}
                          onChange={(ev) => setBpEntries(bpEntries.map((x, j) => j === i ? { ...x, presetId: Number(ev.target.value) } : x))}
                          className="min-w-[160px] rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary"
                        >
                          {presets.map((pr) => <option key={pr.id} value={pr.id}>{pr.gameIcon ?? ""} {pr.name}{pr.mine ? "" : " (shared)"}</option>)}
                        </select>
                        <input
                          type="number" min={1} max={5} value={e.count}
                          onChange={(ev) => setBpEntries(bpEntries.map((x, j) => j === i ? { ...x, count: Math.max(1, Math.min(5, Number(ev.target.value) || 1)) } : x))}
                          className="w-14 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary"
                          title="Copies (1–5)"
                        />
                        <input
                          value={e.namePattern ?? ""}
                          onChange={(ev) => setBpEntries(bpEntries.map((x, j) => j === i ? { ...x, namePattern: ev.target.value } : x))}
                          placeholder='Server name pattern — {n} = number; blank = "Preset #n"'
                          className="min-w-[180px] flex-1 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted"
                        />
                        <button onClick={() => setBpEntries(bpEntries.filter((_, j) => j !== i))} className="text-xs text-text-muted hover:text-danger" title="Remove entry">✕</button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setBpEntries([...bpEntries, { presetId: presets[0]?.id ?? 0, count: 1, namePattern: "" }])}
                        disabled={presets.length === 0}
                        className="rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                      >+ Add entry</button>
                      <button
                        onClick={() => void saveBlueprint()}
                        disabled={!bpName.trim() || bpEntries.length === 0 || bpBusy !== null}
                        className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                      >{bpBusy === "save" ? "Saving…" : "Save blueprint"}</button>
                    </div>
                    <p className="text-[10px] text-text-muted">Up to 10 entries, 5 copies each, 15 servers total per blueprint. Deploys stop at the first failure.</p>
                  </>
                )}
              </div>
            </div>
          )}
          {filteredServers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-bg-card p-8 text-center text-sm text-text-muted">
              <p>No servers match the current search or status filter.</p>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="mt-3 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover transition-colors">
                  Show all servers
                </button>
              )}
            </div>
          ) : groupedServers.map((group) => (
            <div key={`${group.nodeId ?? "none"}-${group.nodeName}`} className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-secondary px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{group.nodeName}</p>
                  <p className="text-xs text-text-muted">{group.servers.length} server{group.servers.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="text-xs text-text-muted">
                  {group.nodeName === "Unassigned" ? "No node assigned" : "Grouped by hosting node"}
                </div>
              </div>
              <div className="space-y-4">
                {group.servers.map((server) => {
                  const st = STATUS_MAP[server.status] || STATUS_MAP.stopped;
                  const isInstalling = installingId === server.id || server.status === "installing";
                  const uptime = server.status === "running" ? formatUptime(server.lastStarted) : "";
                  const isSelected = selected.has(server.id);
                  return (
                    <div key={server.id} className={`bg-bg-card border rounded-xl overflow-hidden transition-all hover:shadow-md ${isSelected ? "border-accent/40 ring-1 ring-accent/20" : server.status === "running" ? "border-success/20" : "border-border"}`}>
                      <div className="p-5">
                        <div className="flex items-start gap-4">
                          {/* Checkbox */}
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(server.id)} className="rounded w-4 h-4 accent-accent mt-2 flex-shrink-0" />
                          {/* Icon with status dot */}
                          <div className="relative flex-shrink-0">
                            <span className="text-4xl block">{server.gameIcon || "🎮"}</span>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-bg-card ${st.dot}`} title={st.label} />
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-lg leading-tight truncate">
                              {server.name}{server.notes ? <span title={server.notes} style={{ marginLeft: 6 }}>📝</span> : null}{server.sharedWithMe ? <span title="Shared with you by its owner" className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 align-middle">shared</span> : null}
                              {sortTags(server.tags).map((t) => (
                                <button
                                  key={t}
                                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                                  title={`Filter by tag "${t}"`}
                                  className={`ml-1.5 align-middle text-[10px] font-semibold px-1.5 py-0.5 rounded-full border transition-colors ${tagFilter === t ? "bg-accent text-white border-accent" : "bg-bg-secondary text-text-muted border-border hover:border-accent hover:text-accent"}`}
                                >#{t}</button>
                              ))}
                            </h3>
                            <p className="text-text-secondary text-sm">{server.gameName}</p>
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              {server.expiresAt && new Date(server.expiresAt).getTime() > Date.now() && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-warning/15 text-warning border border-warning/30" title={`Ephemeral: auto-deletes ${new Date(server.expiresAt).toLocaleString()}`}>
                                  ⏳ exp {new Date(server.expiresAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                </span>
                              )}
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${st.bg}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                              </span>
                              {server.discordWebhook && <span className="text-xs text-[#5865F2]">🔔 Discord</span>}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-border bg-bg-secondary/70 p-3 text-[11px] text-text-secondary">
                              <span className="rounded-full bg-bg-card px-2.5 py-1 font-medium text-text-primary">{formatLastSeen(server)}</span>
                              <span className="rounded-full bg-bg-card px-2.5 py-1">{server.pid && server.status === "running" ? `PID ${server.pid}` : "No PID"}</span>
                              <button
                                type="button"
                                onClick={() => toggleServerFlag(server.id, "autoRestart", !server.autoRestart)}
                                title="Restart this server automatically if it crashes"
                                className={`rounded-full px-2.5 py-1 font-medium transition-opacity hover:opacity-80 ${server.autoRestart ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
                              >
                                Auto-restart {server.autoRestart ? "on" : "off"}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleServerFlag(server.id, "autoStart", !server.autoStart)}
                                title="Start this server automatically when the node boots"
                                className={`rounded-full px-2.5 py-1 font-medium transition-opacity hover:opacity-80 ${server.autoStart ? "bg-success/10 text-success" : "bg-bg-card text-text-secondary"}`}
                              >
                                Start on boot {server.autoStart ? "on" : "off"}
                              </button>
                              {server.discordWebhook && (
                                <button
                                  type="button"
                                  onClick={() => toggleServerFlag(server.id, "discordNotifyPlayers", server.discordNotifyPlayers === false)}
                                  title="Post a Discord message when players join or leave"
                                  className={`rounded-full px-2.5 py-1 font-medium transition-opacity hover:opacity-80 ${server.discordNotifyPlayers !== false ? "bg-[#5865F2]/15 text-[#8b95f7]" : "bg-bg-card text-text-secondary"}`}
                                >
                                  Player alerts {server.discordNotifyPlayers !== false ? "on" : "off"}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleServerFlag(server.id, "statusPublic", !server.statusPublic)}
                                title="List this server on the public status board at /status"
                                className={`rounded-full px-2.5 py-1 font-medium transition-opacity hover:opacity-80 ${server.statusPublic ? "bg-sky-500/15 text-sky-400" : "bg-bg-card text-text-secondary"}`}
                              >
                                Public listing {server.statusPublic ? "on" : "off"}
                              </button>
                              <span className="rounded-full bg-bg-card px-2.5 py-1">Port {server.ipv4 && server.ipv4 !== "0.0.0.0" ? `${server.ipv4}:${server.port}` : server.port}</span>
                              <span className="rounded-full bg-bg-card px-2.5 py-1">{server.lastStarted ? `Started ${new Date(server.lastStarted).toLocaleDateString()}` : "Never started"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Action bar */}
                      <div className="px-5 py-3 bg-bg-secondary/50 border-t border-border flex items-center gap-2 flex-wrap">
                        {server.status === "running" ? (<><Btn onClick={() => controlProcess(server.id, "stop")} color="danger" icon="⏹" label="Stop" /><Btn onClick={() => controlProcess(server.id, "restart")} color="warning" icon="🔄" label="Restart" /></>) : (<Btn onClick={() => controlProcess(server.id, "start")} color="success" icon="▶" label="Start" />)}
                        <div className="w-px h-5 bg-border mx-1" />
                        <Btn onClick={() => installServerFiles(server.id)} color="accent" icon="📥" label={isInstalling ? "Installing..." : "Install"} disabled={isInstalling} />
                        <Btn onClick={() => updateServer(server.id)} color="accent" icon="🔄" label="Update" />
                        <Btn onClick={() => backupServer(server.id)} color="muted" icon="💾" label="Backup" />
                        <Btn onClick={() => void drillBackup(server.id)} color="muted" icon="🧪" label="Drill" title="Test-restore the newest backup (proves it works; live files untouched)" />
                        <Btn onClick={() => openConsole(server.id)} color="muted" icon="📋" label="Console" />
                        <Btn onClick={() => cloneServer(server.id)} color="muted" icon="📑" label="Clone" />
                        <Btn onClick={() => void cloneWithTtl(server.id, 24)} color="muted" icon="⏳" label="24h" title="Ephemeral clone: auto stop+delete after 24 hours" />
                        <Btn onClick={() => { setMigrateId(migrateId === server.id ? null : server.id); setMigrateTarget(""); }} color="muted" icon="📦" label="Migrate" disabled={migratingId === server.id} title="Move this server to another node" />
                        <Btn onClick={() => toggleMetrics(server.id)} color="muted" icon="📈" label="Metrics" title="CPU and RAM history" />
                        <Btn onClick={() => openNotes(server)} color="muted" icon="📝" label="Notes" title="Free-form operator notes for this server" />
                        <Btn onClick={() => void createShareLink(server.id)} color="muted" icon="🔗" label="Share" title="Public status link (up + players, no account needed)" disabled={shareBusy} />
                        <Btn onClick={() => void copyConnect(server)} color="muted" icon="🔌" label="Connect" title="Copy the game-specific join/connect string" />
                        <div className="ml-auto" />
                        {user.role === "admin" && <Btn onClick={() => deleteServer(server.id)} color="danger" icon="🗑️" label="" title="Delete server" small />}
                      </div>

                      {/* ═══ MIGRATE ═══ */}
                      {migrateId === server.id && (
                        <div className="px-5 py-4 border-t border-border bg-bg-secondary/30 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold">📦 Migrate to another node</h4>
                            <button onClick={() => setMigrateId(null)} className="text-text-muted text-xs">✕</button>
                          </div>
                          <p className="text-[11px] text-text-muted">The server must be stopped. Its files are archived on the source, transferred through the panel, and unpacked on the destination, then the server record is re-pointed. Remote nodes need the agent deployed.</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <select value={migrateTarget} onChange={(e) => setMigrateTarget(e.target.value)} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40">
                              <option value="">Choose a destination node…</option>
                              {nodeList.filter((n) => n.id !== server.nodeId).map((n) => (
                                <option key={n.id} value={n.id}>{n.name}{n.isLocal ? " (local)" : ""}</option>
                              ))}
                            </select>
                            <button onClick={() => void migrateServer(server.id)} disabled={migratingId === server.id || !migrateTarget} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                              {migratingId === server.id ? "Moving…" : "Migrate"}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* ═══ METRICS HISTORY ═══ */}
                      {metricsId === server.id && (
                        <div className="px-5 py-4 border-t border-border bg-bg-secondary/30 space-y-3">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-semibold">📈 CPU &amp; RAM history</h4>
                              {metricsId !== null && (
                                <a href={`/api/servers/${metricsId}/metrics?hours=${metricsRange}&format=csv`} className="text-[11px] px-2 py-1 rounded-lg bg-bg-tertiary text-text-secondary hover:bg-bg-hover font-medium">⬇ CSV</a>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {[{ h: 1, l: "1h" }, { h: 6, l: "6h" }, { h: 24, l: "24h" }, { h: 168, l: "7d" }].map((r) => (
                                <button key={r.h} onClick={() => changeMetricsRange(r.h)} className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${metricsRange === r.h ? "bg-accent text-white" : "bg-bg-card text-text-secondary hover:text-text-primary border border-border"}`}>{r.l}</button>
                              ))}
                              <button onClick={() => toggleMetrics(server.id)} className="ml-2 text-text-muted text-xs">✕</button>
                            </div>
                          </div>
                          {metricsLoading ? (
                            <div className="py-8 text-center text-xs text-text-muted">Loading samples…</div>
                          ) : metrics ? (
                            <>
                              <div className="grid gap-3 md:grid-cols-2">
                                <MetricsChart points={metrics.cpu} color="#38bdf8" label="CPU usage" unit="%" />
                                <MetricsChart points={metrics.ram} color="#a78bfa" label="Memory used" unit=" MB" />
                              </div>

                              {/* Live roster */}
                              <div className="rounded-lg border border-border bg-bg-secondary/60 p-3">
                                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                                  <p className="text-xs font-medium text-text-secondary">👥 Live roster</p>
                                  <button onClick={() => void loadRoster(server.id)} disabled={rosterBusy} className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-bg-tertiary text-text-secondary hover:bg-bg-hover disabled:opacity-40">{rosterBusy ? "Probing…" : "↻ Refresh"}</button>
                                </div>
                                {roster === null ? (
                                  <p className="text-[11px] text-text-muted">Ask the game who is online right now (local nodes; one probe per 30s).</p>
                                ) : !roster.reachable ? (
                                  <p className="text-[11px] text-warning">Server did not answer the player query (down, starting, or no query port).</p>
                                ) : (
                                  <div>
                                    <p className="text-xs text-text-secondary">
                                      {roster.players ?? 0}{roster.maxPlayers ? `/${roster.maxPlayers}` : ""} players{roster.map ? ` · map ${roster.map}` : ""}
                                    </p>
                                    {roster.names.length > 0 && (
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        {roster.names.slice(0, 40).map((n, i) => (
                                          <span key={i} className="px-1.5 py-0.5 rounded bg-bg-tertiary text-[10px] font-mono text-text-secondary">{n}</span>
                                        ))}
                                        {roster.names.length > 40 && <span className="text-[10px] text-text-muted">+{roster.names.length - 40} more</span>}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Peak-hours heatmap */}
                              {heatmap !== null && (heatmap.cells.length > 0 ? (
                                <div className="rounded-lg border border-border bg-bg-secondary/60 p-3">
                                  <p className="text-xs font-medium text-text-secondary mb-2">
                                    🔥 Peak hours (14d){heatmap.peakLabel ? ` · busiest around ${heatmap.peakLabel}` : ""}
                                  </p>
                                  {(() => {
                                    const maxAvg = Math.max(...heatmap.cells.map((c) => c.avg), 0.001);
                                    const byCell = new Map(heatmap.cells.map((c) => [`${c.day}:${c.hour}`, c]));
                                    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                                    return (
                                      <div className="overflow-x-auto">
                                        <table style={{ borderCollapse: "separate", borderSpacing: 2 }}>
                                          <tbody>
                                            {days.map((d, day) => (
                                              <tr key={d}>
                                                <td className="text-[9px] text-text-muted pr-1">{d}</td>
                                                {Array.from({ length: 24 }, (_, hour) => {
                                                  const cell = byCell.get(`${day}:${hour}`);
                                                  const intensity = cell ? Math.max(0.15, cell.avg / maxAvg) : 0;
                                                  return (
                                                    <td
                                                      key={hour}
                                                      title={cell ? `${d} ${String(hour).padStart(2, "0")}:00 — avg ${cell.avg} players (${cell.samples} samples)` : `${d} ${String(hour).padStart(2, "0")}:00 — no data`}
                                                      style={{ width: 10, height: 10, borderRadius: 2, background: cell ? `rgba(56,189,248,${intensity})` : "var(--bg-tertiary)" }}
                                                    />
                                                  );
                                                })}
                                              </tr>
                                            ))}
                                            <tr>
                                              <td />
                                              {Array.from({ length: 24 }, (_, h) => (
                                                <td key={h} className="text-[8px] text-text-muted text-center">{h % 6 === 0 ? h : ""}</td>
                                              ))}
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    );
                                  })()}
                                  <p className="text-[10px] text-text-muted mt-1.5">Sampled every ~10 minutes while the server runs. Restart into your community&apos;s peak for the least disruption.</p>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-border bg-bg-secondary/60 p-3">
                                  <p className="text-xs font-medium text-text-secondary mb-1">🔥 Peak hours</p>
                                  <p className="text-[11px] text-text-muted">No player samples yet — the idle detector records them every ~10 minutes while this server runs.</p>
                                </div>
                              ))}
                              {metrics.events.length > 0 && (
                                <div className="rounded-lg border border-border bg-bg-secondary/60 p-3">
                                  <p className="text-xs font-medium text-text-secondary mb-2">Recent events (14-day history)</p>
                                  <ul className="space-y-1">
                                    {metrics.events.map((ev, i) => (
                                      <li key={i} className="flex items-baseline justify-between gap-3 text-[11px]">
                                        <span className={ev.kind === "crashed" ? "text-danger" : ev.kind === "watchdog-stop" ? "text-warning" : "text-text-secondary"}>
                                          {ev.kind === "crashed" ? "💥 Crashed" : ev.kind === "watchdog-stop" ? "⛔ Watchdog stop" : "🔁 Auto-restarted"}
                                          {ev.detail ? <span className="text-text-muted"> — {ev.detail}</span> : null}
                                        </span>
                                        <span className="text-text-muted whitespace-nowrap">{new Date(ev.createdAt).toLocaleString()}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <p className="text-[10px] text-text-muted">
                                {metrics.samples.toLocaleString()} samples in window · recorded while the server runs
                                {metrics.dirMb !== null && <> · server folder {metrics.dirMb >= 1024 ? `${Math.round((metrics.dirMb / 1024) * 10) / 10} GB` : `${metrics.dirMb} MB`}</>}
                                {metrics.disk && <> · disk {Math.round((metrics.disk.usedMb / Math.max(1, metrics.disk.totalMb)) * 100)}% full of {Math.round(metrics.disk.totalMb / 1024)} GB</>}
                              </p>
                            </>
                          ) : null}
                        </div>
                      )}

                      {/* ═══ NOTES ═══ */}
                      {notesId === server.id && (
                        <div className="px-5 py-4 border-t border-border bg-bg-secondary/30 space-y-2">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <h4 className="text-sm font-semibold">📝 Notes &amp; 🏷️ Tags</h4>
                            <button onClick={() => setNotesId(null)} className="text-text-muted text-xs">✕</button>
                          </div>
                          <div>
                            <label className="block text-[11px] text-text-muted mb-1">Tags (comma-separated, max 8 — e.g. tf2, eu, tournament)</label>
                            <input value={tagsDraft} onChange={(e) => setTagsDraft(e.target.value)} className={inputCls} placeholder="tf2, casual, friday-night" />
                          </div>
                          <div>
                            <label className="block text-[11px] text-text-muted mb-1">⏰ Daily automatic restart (panel time)</label>
                            {(() => {
                              const on = !!(dailyRestart?.scheduled && dailyRestart.enabled);
                              return (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <select
                                    value={dailyRestart?.hour ?? 4}
                                    disabled={dailyRestartBusy || !on}
                                    onChange={(e) => void setDailyRestartSchedule(server.id, true, Number(e.target.value), dailyRestart?.minute ?? 0)}
                                    className={inputCls}
                                    style={{ width: 76 }}
                                  >
                                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")} h</option>)}
                                  </select>
                                  <span className="text-text-muted text-sm">:</span>
                                  <select
                                    value={dailyRestart?.minute ?? 0}
                                    disabled={dailyRestartBusy || !on}
                                    onChange={(e) => void setDailyRestartSchedule(server.id, true, dailyRestart?.hour ?? 4, Number(e.target.value))}
                                    className={inputCls}
                                    style={{ width: 76 }}
                                  >
                                    {Array.from({ length: 60 }, (_, m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={dailyRestartBusy}
                                    onClick={() => void setDailyRestartSchedule(server.id, !on, dailyRestart?.hour ?? 4, dailyRestart?.minute ?? 0)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${on ? "bg-success/15 text-success hover:bg-success/25" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover"}`}
                                  >
                                    {dailyRestartBusy ? "Working…" : on ? "Scheduled ✓ — click to disable" : "Enable daily restart"}
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <label className="block text-[11px] text-text-muted mb-1">💾 Daily automatic backup (panel time)</label>
                            {(() => {
                              const on = !!(dailyBackup?.scheduled && dailyBackup.enabled);
                              return (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <select
                                    value={dailyBackup?.hour ?? 3}
                                    disabled={dailyBackupBusy || !on}
                                    onChange={(e) => void setDailyBackupSchedule(server.id, true, Number(e.target.value), dailyBackup?.minute ?? 30)}
                                    className={inputCls}
                                    style={{ width: 76 }}
                                  >
                                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")} h</option>)}
                                  </select>
                                  <span className="text-text-muted text-sm">:</span>
                                  <select
                                    value={dailyBackup?.minute ?? 30}
                                    disabled={dailyBackupBusy || !on}
                                    onChange={(e) => void setDailyBackupSchedule(server.id, true, dailyBackup?.hour ?? 3, Number(e.target.value))}
                                    className={inputCls}
                                    style={{ width: 76 }}
                                  >
                                    {Array.from({ length: 60 }, (_, m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={dailyBackupBusy}
                                    onClick={() => void setDailyBackupSchedule(server.id, !on, dailyBackup?.hour ?? 3, dailyBackup?.minute ?? 30)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${on ? "bg-success/15 text-success hover:bg-success/25" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover"}`}
                                  >
                                    {dailyBackupBusy ? "Working…" : on ? "Scheduled ✓ — click to disable" : "Enable daily backup"}
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                          <textarea
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            maxLength={2000}
                            rows={3}
                            className={inputCls}
                            placeholder={'Free-form notes for this server — e.g. "Map rotation on Tuesdays", "Do not update before the tournament on the 14th"…'}
                          />
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-[10px] text-text-muted">{notesDraft.trim().length}/2000 · visible to everyone who can view this server</p>
                            <div className="flex items-center gap-2">
                              {(server.notes || notesDraft.trim()) ? (
                                <button onClick={() => setNotesDraft("")} className="px-3 py-1.5 text-xs text-text-muted hover:text-danger">Clear</button>
                              ) : null}
                              <button onClick={() => void saveServerDetails(server.id)} disabled={notesSaving} className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-xs font-medium">{notesSaving ? "Saving…" : "Save"}</button>
                            </div>
                          </div>
                          {serverChanges !== null && (
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">📜 Recent changes</label>
                              {serverChanges.length === 0 ? (
                                <p className="text-xs text-text-muted">No recorded changes yet.</p>
                              ) : (
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {serverChanges.map((c, i) => (
                                    <p key={i} className="text-xs text-text-secondary font-mono bg-bg-secondary rounded px-2 py-1">
                                      <span className="text-text-muted">{new Date(c.at).toLocaleString()}</span> · {c.by ?? "panel"} · {c.field}: <span className="text-danger line-through">{c.from}</span> → <span className="text-success">{c.to}</span>
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {(user.role === "admin" || server.userId === user.id) && (
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">👥 Sharing</label>
                              {collabs[server.id] === undefined ? (
                                <button onClick={() => void loadCollabs(server.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-tertiary text-text-secondary hover:bg-bg-hover">Load collaborators</button>
                              ) : (
                                <div className="space-y-2">
                                  {collabs[server.id]!.length === 0 ? (
                                    <p className="text-xs text-text-muted">Only you have access so far.</p>
                                  ) : (
                                    <div className="space-y-1">
                                      {collabs[server.id]!.map((c) => (
                                        <div key={c.id} className="flex items-center gap-2 bg-bg-secondary rounded px-2 py-1.5">
                                          <span className="flex-1 text-xs text-text-secondary truncate">{c.email ?? `user #${c.userId}`}</span>
                                          <select
                                            value={c.role}
                                            disabled={collabBusy === server.id}
                                            onChange={(e) => void setCollabRole(server.id, c.userId, e.target.value as "viewer" | "operator")}
                                            className="rounded border border-border bg-bg-card px-1.5 py-0.5 text-[11px] text-text-secondary"
                                          >
                                            <option value="viewer">viewer — read-only</option>
                                            <option value="operator">operator — can start/stop</option>
                                          </select>
                                          <button
                                            onClick={() => void removeCollab(server.id, c.userId, c.email ?? `user #${c.userId}`)}
                                            disabled={collabBusy === server.id}
                                            title="Remove access"
                                            className="text-text-muted hover:text-danger text-xs disabled:opacity-40"
                                          >✕</button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <input
                                      value={collabEmail}
                                      onChange={(e) => setCollabEmail(e.target.value)}
                                      placeholder="teammate@example.com"
                                      className="flex-1 min-w-[180px] rounded-lg border border-border bg-bg-card px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted"
                                    />
                                    <select
                                      value={collabRoleSel}
                                      onChange={(e) => setCollabRoleSel(e.target.value as "viewer" | "operator")}
                                      className="rounded-lg border border-border bg-bg-card px-2 py-1.5 text-xs text-text-secondary"
                                    >
                                      <option value="viewer">viewer</option>
                                      <option value="operator">operator</option>
                                    </select>
                                    <button
                                      onClick={() => void addCollab(server.id)}
                                      disabled={collabBusy === server.id || !collabEmail.trim()}
                                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40"
                                    >{collabBusy === server.id ? "Working…" : "Share"}</button>
                                  </div>
                                  <p className="text-[10px] text-text-muted">Viewers can watch this server but not touch it. Operators can also start/stop/restart. Only you{user.role === "admin" ? " (admins always have full control)" : ""} can change sharing or settings.</p>
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            <label className="text-[11px] text-text-muted">📣 Player alert — notify me when players reach</label>
                            <input
                              type="number" min={1} max={1000}
                              value={alertDrafts[server.id] ?? (server.playerAlertThreshold ? String(server.playerAlertThreshold) : "")}
                              onChange={(e) => setAlertDrafts((d) => ({ ...d, [server.id]: e.target.value }))}
                              placeholder={server.playerAlertThreshold ? String(server.playerAlertThreshold) : "off"}
                              className="w-20 rounded-lg border border-border bg-bg-card px-2 py-1 text-xs text-text-primary"
                            />
                            <button onClick={() => void savePlayerAlert(server.id)} className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover">Save</button>
                            {server.playerAlertThreshold ? (
                              <button onClick={() => void savePlayerAlert(server.id, true)} className="text-xs text-text-muted hover:text-danger">Disable</button>
                            ) : (
                              <span className="text-[10px] text-text-muted">currently off — fires once per crossing via this server's Discord webhook</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ═══ PUBLIC STATUS LINK ═══ */}
                      {shareId === server.id && shareUrl && (
                        <div className="px-5 py-4 border-t border-border bg-bg-secondary/30 space-y-2">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <h4 className="text-sm font-semibold">🔗 Public status link</h4>
                            <button onClick={() => { setShareId(null); setShareUrl(""); }} className="text-text-muted text-xs">✕</button>
                          </div>
                          <p className="text-[11px] text-text-muted">Anyone with this link can see whether the server is up and how many players are on — no account needed. The link is unguessable; creating a new one or revoking stops the old one. Flip the “Public listing” chip on the card to also feature it on the shared board at <code>/status</code>.</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="flex-1 min-w-[220px] truncate rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary">{shareUrl}</code>
                            <button onClick={() => void copyShareLink()} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">Copy</button>
                            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">Open ↗</a>
                            <button onClick={() => void revokeShareLink(server.id)} disabled={shareBusy} className="rounded-lg border border-danger/30 bg-bg-card px-3 py-2 text-xs font-medium text-danger hover:bg-danger/10 transition-colors disabled:opacity-40">Revoke</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A single game-template option field.
 *
 * Defined at module scope on purpose. It used to live inside ServersPanel,
 * which meant React saw a brand-new component type on every render: each
 * keystroke re-created the function, so the old input was unmounted and a
 * fresh one mounted in its place. The DOM node changed identity, focus was
 * lost, and the caret jumped out of the field after a single character.
 * Hoisting it keeps the element identity stable across renders.
 */
function VarField({
  v,
  value,
  onChange,
  inputCls,
}: {
  v: TemplateVar;
  value: string;
  onChange: (envVariable: string, next: string) => void;
  inputCls: string;
}) {
  const req = v.rules?.includes("required");
  const set = (nv: string) => onChange(v.env_variable, nv);

  if (v.field_type === "select" || (v.enum_values && Object.keys(v.enum_values).length > 0)) {
    return (
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">{v.name}</label>
        <select value={value} onChange={(e) => set(e.target.value)} className={inputCls} required={req}>
          {Object.entries(v.enum_values || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {v.description && <p className="text-[10px] text-text-muted mt-1">{v.description}</p>}
      </div>
    );
  }

  if (v.field_type === "checkbox") {
    return (
      <div className="flex items-start gap-3 py-1">
        <input
          type="checkbox"
          checked={["true", "1", "True"].includes(value)}
          onChange={(e) => set(e.target.checked ? "true" : "false")}
          className="rounded mt-0.5 w-4 h-4 accent-accent"
        />
        <div>
          <p className="text-sm font-medium">{v.name}</p>
          {v.description && <p className="text-[10px] text-text-muted">{v.description}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1.5">
        {v.name} {req && <span className="text-warning">*</span>}
      </label>
      <input
        type={v.field_type === "password" ? "password" : v.field_type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={inputCls}
        placeholder={v.default_value || v.description || v.name}
        required={req}
      />
      {v.description && <p className="text-[10px] text-text-muted mt-1">{v.description}</p>}
    </div>
  );
}

function Btn({ onClick, color, icon, label, disabled, small, title }: { onClick: () => void; color: string; icon: string; label: string; disabled?: boolean; small?: boolean; title?: string }) {
  const colors: Record<string, string> = { success: "bg-success/15 text-success hover:bg-success/25", danger: "bg-danger/15 text-danger hover:bg-danger/25", warning: "bg-warning/15 text-warning hover:bg-warning/25", accent: "bg-accent/15 text-accent hover:bg-accent/25", muted: "bg-bg-tertiary text-text-secondary hover:bg-bg-hover" };
  // With no visible label the button is an emoji, which a screen reader either
  // skips or reads as "button". `title` names it for both assistive tech and
  // a hovering mouse; the emoji itself is hidden so it is not read aloud.
  const name = label || title;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label ? undefined : name}
      className={`${small ? "px-2 py-1.5" : "px-3 py-1.5"} ${colors[color] || colors.muted} rounded-lg text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5`}
    >
      <span aria-hidden="true">{icon}</span>
      {label && <span>{label}</span>}
    </button>
  );
}

function Notice({ icon, text }: { icon: string; text: string }) {
  return <div className="flex items-center gap-3 bg-warning/10 border border-warning/20 rounded-xl p-4 text-warning text-sm"><span className="text-xl">{icon}</span><p>{text}</p></div>;
}

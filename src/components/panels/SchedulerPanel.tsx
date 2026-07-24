"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";

interface Task {
  id: number; serverId: number | null; taskType: string; cronExpression: string | null;
  command: string | null; enabled: boolean | null; lastRun: string | null; nextRun: string | null;
  createdAt: string; serverName: string | null;
}
interface Server { id: number; name: string }

const TASK_TYPES = [
  { value: "restart", label: "🔄 Restart", desc: "Restart the server process" },
  { value: "backup", label: "💾 Backup", desc: "Create a backup archive" },
  { value: "update", label: "📥 Update", desc: "Run SteamCMD app_update" },
  { value: "command", label: "⌨️ Command", desc: "Run a custom shell command" },
];

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at 4 AM", value: "0 4 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Every Monday 3 AM", value: "0 3 * * 1" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
];

export default function SchedulerPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ serverId: "", taskType: "restart", cronExpression: "0 4 * * *", command: "" });

  const load = useCallback(async () => {
    try {
      const [tRes, sRes] = await Promise.allSettled([fetch("/api/scheduler"), fetch("/api/servers")]);
      if (tRes.status === "fulfilled" && tRes.value.ok) setTasks((await tRes.value.json()).tasks || []);
      if (sRes.status === "fulfilled" && sRes.value.ok) setServers((await sRes.value.json()).servers || []);
    } catch { /**/ } finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/scheduler", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) toast.error("Failed", data.error);
      else { toast.success("Task Created", `${form.taskType} scheduled`); setShowCreate(false); load(); }
    } catch (e) { toast.error("Error", e instanceof Error ? e.message : "Failed"); }
  }

  async function toggleTask(id: number, current: boolean | null) {
    await fetch(`/api/scheduler/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !current }) });
    load();
  }

  async function deleteTask(id: number) {
    const ok = await confirm({ title: "Delete Task", message: "Remove this scheduled task?", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await fetch(`/api/scheduler/${id}`, { method: "DELETE" });
    toast.info("Task Deleted");
    load();
  }

  const ic = "w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm";

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold">⏰ Server Scheduler</h2><p className="text-text-secondary text-sm">Schedule automatic restarts, backups, updates, and commands</p></div>
        <button onClick={() => setShowCreate(!showCreate)} className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">{showCreate ? "✕ Cancel" : "+ New Task"}</button>
      </div>

      {showCreate && (
        <form onSubmit={createTask} className="bg-bg-card border border-accent/30 rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Create Scheduled Task</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Server *</label>
              <select value={form.serverId} onChange={(e) => setForm({ ...form, serverId: e.target.value })} className={ic} required>
                <option value="">Choose server...</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Task Type *</label>
              <select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })} className={ic}>
                {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>)}
              </select>
            </div>
            <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Schedule (Cron) *</label>
              <input value={form.cronExpression} onChange={(e) => setForm({ ...form, cronExpression: e.target.value })} className={ic} placeholder="0 4 * * *" required />
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {CRON_PRESETS.map((p) => <button key={p.value} type="button" onClick={() => setForm({ ...form, cronExpression: p.value })} className="px-2 py-1 bg-bg-secondary border border-border rounded text-[10px] hover:border-accent/30">{p.label}</button>)}
              </div>
            </div>
            {form.taskType === "command" && (
              <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Command</label>
                <input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} className={ic} placeholder="echo hello" />
              </div>
            )}
          </div>
          <button type="submit" className="px-6 py-2.5 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Create Task</button>
        </form>
      )}

      {!loaded && <div className="text-center py-12"><div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}

      {loaded && tasks.length === 0 && !showCreate && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">⏰</span><h3 className="font-semibold mb-1">No scheduled tasks</h3>
          <p className="text-text-secondary text-sm">Create a task to automate server restarts, backups, or updates.</p>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div key={task.id} className={`bg-bg-card border rounded-xl p-5 ${task.enabled ? "border-border" : "border-border opacity-50"}`}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">{TASK_TYPES.find((t) => t.value === task.taskType)?.label?.slice(0, 2) || "📌"}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{task.taskType}</h3>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${task.enabled ? "bg-success/15 text-success" : "bg-bg-secondary text-text-muted"}`}>{task.enabled ? "Active" : "Disabled"}</span>
                    </div>
                    <p className="text-sm text-text-secondary">{task.serverName || `Server #${task.serverId}`}</p>
                    <div className="flex gap-3 mt-1 text-xs text-text-muted">
                      <span className="font-mono">{task.cronExpression}</span>
                      {task.lastRun && <span>Last: {new Date(task.lastRun).toLocaleString()}</span>}
                      {task.nextRun && <span>Next: {new Date(task.nextRun).toLocaleString()}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggleTask(task.id, task.enabled)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${task.enabled ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>{task.enabled ? "Disable" : "Enable"}</button>
                  <button onClick={() => deleteTask(task.id)} className="px-3 py-1.5 bg-danger/15 text-danger rounded-lg text-xs font-medium">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

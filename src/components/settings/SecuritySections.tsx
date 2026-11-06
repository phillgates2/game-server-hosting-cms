"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  ipAllowed,
  ipMatchesRule,
  parseAllowList,
} from "@/lib/ip-allowlist";
import { BTN, Badge, INPUT, SectionCard } from "./settingsUi";

/** Mirrors the rule check in /api/settings/ip-allowlist. */
const RULE_RE = /^[0-9A-Fa-f:.]*\*?$/;

/**
 * IP allowlist.
 *
 * The old control was a textarea and a Save button: a typo locked you out, and
 * there was no way to see what the list would actually do. This version
 * validates the rules as you type, shows the parsed rules as removable chips,
 * previews whether your own address still gets in, and asks before a save that
 * would shut you out (loopback and the console still pass, but nobody wants to
 * discover that the hard way).
 */
export function IpAllowlistBlock() {
  const toast = useToast();
  const confirm = useConfirm();

  const [spec, setSpec] = useState("");
  const [savedSpec, setSavedSpec] = useState("");
  const [yourIp, setYourIp] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/ip-allowlist");
      if (!res.ok) {
        setUnavailable(res.status === 401 || res.status === 403);
        return;
      }
      const data = await res.json();
      setSpec(data.spec ?? "");
      setSavedSpec(data.spec ?? "");
      setYourIp(data.yourIp ?? null);
    } catch {
      setUnavailable(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Deferred one turn so the mount render finishes before the fetch's
    // first setState — the same pattern the other panels use.
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rules = useMemo(() => parseAllowList(spec), [spec]);
  const invalidRules = useMemo(
    () => rules.filter((rule) => !RULE_RE.test(rule)),
    [rules]
  );
  const coversMe =
    rules.length === 0 || (yourIp ? ipAllowed(yourIp, rules) : true);
  const dirty = spec.trim() !== savedSpec.trim();
  const canAddSelf =
    Boolean(yourIp) && !rules.some((rule) => ipMatchesRule(yourIp as string, rule));

  async function save() {
    if (invalidRules.length > 0) {
      toast.error(
        "Check the rules",
        `${invalidRules[0]} is not an IP address or an IP glob like 10.0.0.*`
      );
      return;
    }
    if (rules.length > 0 && yourIp && !coversMe) {
      const ok = await confirm({
        title: "This would lock you out",
        message: `Your current address (${yourIp}) is not covered by these rules, so the panel would refuse your next request. Only the console (loopback) would still work. Add the address first, or save anyway if you are moving to another network.`,
        confirmLabel: "Save anyway",
        danger: true,
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/settings/ip-allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("IP allowlist", data?.error || "Could not save the allowlist");
        return;
      }
      setSpec(data.spec ?? "");
      setSavedSpec(data.spec ?? "");
      setYourIp(data.yourIp ?? null);
      toast.success(
        "IP allowlist saved",
        (data.rules?.length ?? 0) > 0
          ? `Only ${data.rules.length} rule${data.rules.length === 1 ? "" : "s"} may use the panel now (loopback always passes).`
          : "Allowlist cleared — the panel is open to all IPs again."
      );
    } catch {
      toast.error("IP allowlist", "Could not reach the panel");
    } finally {
      setBusy(false);
    }
  }

  function removeRule(rule: string) {
    setSpec(rules.filter((r) => r !== rule).join("\n"));
  }

  if (!loaded) {
    return (
      <SectionCard icon="🛡️" title="IP allowlist">
        <p className="text-xs text-text-muted">Loading…</p>
      </SectionCard>
    );
  }

  if (unavailable) {
    return (
      <SectionCard
        title="IP allowlist"
        description="Only full administrators can read or change the allowlist."
      >
        <p className="text-xs text-text-muted">
          Your account can view the rest of this screen but not this control.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      icon="🛡️"
      title="IP allowlist"
      description="When set, only these client IPs may use the authenticated panel and API. Loopback always passes, so the panel's own console can never be locked out. Unknown IPs fail closed."
      actions={
        <Badge tone={rules.length > 0 ? "success" : "neutral"}>
          {rules.length > 0
            ? `${rules.length} rule${rules.length === 1 ? "" : "s"} active`
            : "Open to all IPs"}
        </Badge>
      }
    >
      <div className="space-y-3">
        <textarea
          id="ip-allowlist-spec"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          placeholder={"One rule per line or comma-separated.\n203.0.113.9\n10.0.0.*"}
          rows={3}
          spellCheck={false}
          aria-label="IP allowlist rules"
          aria-invalid={invalidRules.length > 0}
          className={`${INPUT} font-mono text-xs`}
        />

        {rules.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {rules.map((rule) => {
              const invalid = invalidRules.includes(rule);
              return (
                <span
                  key={rule}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${
                    invalid
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : "border-border bg-bg-secondary text-text-secondary"
                  }`}
                >
                  {rule}
                  <button
                    type="button"
                    onClick={() => removeRule(rule)}
                    className="text-text-muted hover:text-danger"
                    aria-label={`Remove rule ${rule}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {invalidRules.length > 0 ? (
          <p role="alert" className="text-[11px] font-medium text-danger">
            {invalidRules.length} rule{invalidRules.length === 1 ? "" : "s"} not
            understood: {invalidRules.join(", ")} — use an exact IP or a glob
            ending in .*
          </p>
        ) : (
          rules.length > 0 &&
          !coversMe && (
            <p className="text-[11px] font-medium text-warning">
              ⚠️ Your current IP{yourIp ? ` (${yourIp})` : ""} is not covered by
              these rules. Saving will lock this browser out of the panel.
            </p>
          )
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !dirty || invalidRules.length > 0}
            className={BTN.primary}
            title={
              !dirty
                ? "The allowlist already matches the saved value"
                : invalidRules.length > 0
                  ? "Fix the invalid rules first"
                  : "Save the allowlist"
            }
          >
            {busy ? "Saving…" : dirty ? "Save allowlist" : "Saved"}
          </button>
          <button
            type="button"
            onClick={() => setSpec(savedSpec)}
            disabled={busy || !dirty}
            className={BTN.secondary}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => setSpec([...rules, yourIp as string].filter(Boolean).join("\n"))}
            disabled={busy || !canAddSelf}
            className={BTN.secondary}
            title={
              canAddSelf
                ? `Append your current address${yourIp ? ` (${yourIp})` : ""}`
                : yourIp
                  ? "Your address is already covered"
                  : "Your address is not forwarded by the proxy, so there is nothing safe to add"
            }
          >
            ➕ Add my IP{yourIp ? ` (${yourIp})` : ""}
          </button>
          {rules.length > 0 && (
            <button
              type="button"
              onClick={() => setSpec("")}
              disabled={busy}
              className="text-xs text-text-muted hover:text-danger"
            >
              Clear list
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/**
 * Disaster recovery.
 *
 * Export is a JSON snapshot of panel settings, presets and schedules; the
 * import is deliberately conservative (safe keys, restart/backup/update tasks
 * only) and reports exactly what it restored rather than a bare "done".
 */
export function DisasterRecoveryBlock() {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function downloadExport() {
    setBusy(true);
    try {
      const res = await fetch("/api/maintenance/export");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error("Export", data?.error || "Could not build the export");
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gsm-panel-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export ready", "Settings, presets and schedules saved as JSON.");
    } catch {
      toast.error("Export", "Could not build the export");
    } finally {
      setBusy(false);
    }
  }

  async function importExportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const okConfirm = await confirm({
      title: "Import panel export",
      message:
        "Restore settings (safe keys only), presets and matching schedules from this file? Settings already on this panel are overwritten with the file's values.",
      confirmLabel: "Import",
    });
    if (!okConfirm) return;

    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const res = await fetch("/api/maintenance/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Import", data?.error || "The file was rejected");
        return;
      }
      toast.success(
        "Import complete",
        `${data.settingsRestored} settings, ${data.presetsRestored} presets, ${data.tasksRestored} schedules restored` +
          `${data.tasksUnmatched ? ` · ${data.tasksUnmatched} schedules skipped (server not on this panel)` : ""}` +
          `${data.skippedSettings ? ` · ${data.skippedSettings} settings skipped (not importable)` : ""}. ` +
          "Reload the page to see the restored values in every screen."
      );
    } catch {
      toast.error("Import", "That file is not valid export JSON.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon="🧯"
      title="Export & restore"
      description="Snapshot panel settings, presets and schedules as JSON. Servers and nodes are included for reference only — their files live on disk, and credentials are never exported."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void downloadExport()}
          disabled={busy}
          className={BTN.secondary}
        >
          {busy ? "Working…" : "⬇️ Download export"}
        </button>
        <label
          className={`${BTN.secondary} cursor-pointer ${
            busy ? "pointer-events-none opacity-40" : ""
          }`}
        >
          ⬆️ Restore from export…
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(ev) => void importExportFile(ev)}
            disabled={busy}
          />
        </label>
      </div>
    </SectionCard>
  );
}

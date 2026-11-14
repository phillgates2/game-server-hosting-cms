"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import DiscordSettings from "./DiscordSettings";
import {
  PANEL_SETTING_FIELDS,
  PANEL_SETTING_ORDER,
  diffPanelSettings,
  fieldErrorMessage,
  fieldsForSection,
  panelSettingsPayload,
  type PanelSettingKey,
  type PanelSettings,
} from "@/lib/panel-settings";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  sectionForSettingKey,
  settingsSection,
  type SettingsSectionId,
} from "@/components/settings/sections";
import { BTN, Badge, Card, INPUT } from "@/components/settings/settingsUi";
import { DraftFields } from "@/components/settings/DraftFields";
import {
  DisasterRecoveryBlock,
  IpAllowlistBlock,
} from "@/components/settings/SecuritySections";
import {
  AlertMuteBlock,
  FleetDigestBlock,
  IdleAutoStopBlock,
} from "@/components/settings/AutomationSections";
import {
  DiscordBackfillBlock,
  PublicStatusBlock,
  WebhookBlock,
} from "@/components/settings/IntegrationSections";

interface RetentionStats {
  nodeMetrics: number;
  serverMetrics: number;
  auditLog: number;
}

interface SearchHit {
  id: string;
  section: SettingsSectionId;
  fieldKey?: PanelSettingKey;
  title: string;
  context: string;
}

/**
 * Settings.
 *
 * One long column became a set of screens, each with one job and one save
 * model, because the old page mixed both: some cards applied instantly while
 * others waited for a Save button at the very bottom, and nothing told you
 * which was which. Now:
 *
 *  - the left rail (and the pill bar on phones) switches screens;
 *  - draft screens share a single save bar that appears only when there is
 *    something to save, and lists what will change;
 *  - every value is validated against the same registry the API enforces, so a
 *    bad number is caught before it leaves the browser and the field is
 *    highlighted rather than the save silently failing;
 *  - only the changed fields are sent, so two administrators on different
 *    screens no longer overwrite each other.
 */
export default function SettingsPanel() {
  const { error: showError, success: showSuccess, info: showInfo } = useToast();
  const confirm = useConfirm();

  const [saved, setSaved] = useState<PanelSettings | null>(null);
  const [draft, setDraft] = useState<PanelSettings | null>(null);
  const [stats, setStats] = useState<RetentionStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [section, setSection] = useState<SettingsSectionId>("accounts");
  const [query, setQuery] = useState("");
  const [highlightKey, setHighlightKey] = useState<PanelSettingKey | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const firstSectionRender = useRef(true);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/settings/panel", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(
          res.status === 403
            ? "This account does not have the panel.settings permission."
            : data?.error || "The panel refused the request."
        );
        return;
      }
      const settings = data?.settings as PanelSettings | undefined;
      if (!settings) {
        setLoadError("The panel returned an unexpected response.");
        return;
      }
      setSaved({ ...settings });
      setDraft({ ...settings });
      setStats(data?.stats ?? null);
    } catch {
      setLoadError("The panel could not be reached. Check the connection and retry.");
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

  const clientErrors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!draft) return out;
    for (const key of PANEL_SETTING_ORDER) {
      const field = PANEL_SETTING_FIELDS[key];
      const message = fieldErrorMessage(key, draft[field.prop]);
      if (message) out[key] = message;
    }
    return out;
  }, [draft]);

  const errors = useMemo(
    () => ({ ...serverErrors, ...clientErrors }),
    [serverErrors, clientErrors]
  );

  const changes = useMemo(
    () => (draft && saved ? diffPanelSettings(draft, saved) : []),
    [draft, saved]
  );

  const changesBySection = useMemo(() => {
    const counts = new Map<SettingsSectionId, number>();
    const invalid = new Map<SettingsSectionId, number>();
    for (const change of changes) {
      const meta = sectionForSettingKey(change.key);
      if (!meta) continue;
      counts.set(meta.id, (counts.get(meta.id) ?? 0) + 1);
    }
    for (const key of Object.keys(errors) as PanelSettingKey[]) {
      const meta = sectionForSettingKey(key);
      if (!meta) continue;
      invalid.set(meta.id, (invalid.get(meta.id) ?? 0) + 1);
    }
    return { counts, invalid };
  }, [changes, errors]);

  const affectedScreens = useMemo(() => {
    const ids = new Set<SettingsSectionId>();
    for (const change of changes) {
      const meta = sectionForSettingKey(change.key);
      if (meta) ids.add(meta.id);
    }
    return SETTINGS_SECTIONS.filter((entry) => ids.has(entry.id)).map((entry) => entry.title);
  }, [changes]);

  // Warn before a reload or tab close discards staged changes. Internal
  // navigation cannot be intercepted from here, which is why the save bar is
  // always visible while anything is pending.
  useEffect(() => {
    if (changes.length === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [changes.length]);

  // Scroll to — and focus — a field picked from search or a validation jump.
  useEffect(() => {
    if (!highlightKey) return;
    const scrollTimer = window.setTimeout(() => {
      document
        .getElementById(`setting-${highlightKey}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      const input = document.getElementById(`field-${highlightKey}`);
      if (input instanceof HTMLElement) input.focus({ preventScroll: true });
    }, 80);
    const clearTimer = window.setTimeout(() => setHighlightKey(null), 3200);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightKey]);

  // Bring a newly selected screen to the top, unless we are scrolling to a
  // specific field inside it.
  useEffect(() => {
    if (firstSectionRender.current) {
      firstSectionRender.current = false;
      return;
    }
    if (highlightKey) return;
    contentRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  useEffect(() => {
    if (!savedFlash) return;
    const timer = window.setTimeout(() => setSavedFlash(false), 2600);
    return () => window.clearTimeout(timer);
  }, [savedFlash]);

  const searchHits = useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const hits: SearchHit[] = [];
    for (const meta of SETTINGS_SECTIONS) {
      for (const key of meta.fieldKeys) {
        const field = PANEL_SETTING_FIELDS[key];
        const haystack = [
          field.label,
          field.hint,
          key,
          field.prop,
          ...(field.keywords ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (haystack.includes(needle)) {
          hits.push({
            id: `field-${key}`,
            section: meta.id,
            fieldKey: key,
            title: field.label,
            context: meta.title,
          });
        }
      }
      // Screens made of actions rather than fields match on their own words.
      if (meta.fieldKeys.length === 0) {
        const haystack = [meta.title, meta.blurb, ...meta.keywords]
          .join(" ")
          .toLowerCase();
        if (haystack.includes(needle)) {
          hits.push({
            id: `section-${meta.id}`,
            section: meta.id,
            title: meta.title,
            context: meta.blurb,
          });
        }
      }
    }
    return hits.slice(0, 8);
  }, [query]);

  function selectSection(id: SettingsSectionId) {
    setSection(id);
    // A leftover highlight from search would otherwise point at a field that
    // is no longer on screen.
    setHighlightKey(null);
  }

  function openHit(hit: SearchHit) {
    setSection(hit.section);
    setQuery("");
    if (hit.fieldKey) setHighlightKey(hit.fieldKey);
  }

  function patch(prop: keyof PanelSettings, value: number | boolean) {
    setDraft((previous) =>
      previous ? { ...previous, [prop]: value } : previous
    );
    // A server-side rejection referred to the previous payload.
    if (Object.keys(serverErrors).length > 0) setServerErrors({});
  }

  function jumpToFirstProblem() {
    const firstKey = PANEL_SETTING_ORDER.find((key) => errors[key]);
    if (!firstKey) return;
    const meta = sectionForSettingKey(firstKey);
    if (meta) setSection(meta.id);
    setHighlightKey(firstKey);
  }

  async function save() {
    if (!draft || !saved) return;
    if (changes.length === 0) {
      showInfo("Nothing to save", "Every value already matches what is stored.");
      return;
    }
    if (Object.keys(clientErrors).length > 0) {
      jumpToFirstProblem();
      showError(
        "Fix the highlighted fields first",
        `${Object.keys(clientErrors).length} setting${
          Object.keys(clientErrors).length === 1 ? "" : "s"
        } need a valid value before this can be saved.`
      );
      return;
    }

    setSaving(true);
    setServerErrors({});
    try {
      const payload = panelSettingsPayload(
        draft,
        changes.map((change) => change.key)
      );
      const res = await fetch("/api/settings/panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: payload }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // The server validates against the same registry, so a rejection here
        // is rare — but when it happens, pin the message to the offending field
        // and take the operator to it rather than leaving them to hunt.
        const fieldErrors =
          data?.errors && typeof data.errors === "object"
            ? (data.errors as Record<string, string>)
            : null;
        if (fieldErrors) {
          setServerErrors(fieldErrors);
          const firstKey = PANEL_SETTING_ORDER.find((key) => fieldErrors[key]);
          if (firstKey) {
            const meta = sectionForSettingKey(firstKey);
            if (meta) setSection(meta.id);
            setHighlightKey(firstKey);
          }
        }
        showError("Could not save", data?.error || "Please try again.");
        return;
      }

      setSaved({ ...draft });
      setSavedAt(new Date());
      setSavedFlash(true);
      showSuccess(
        "Settings saved",
        data?.saved
          ? `${data.saved} setting${data.saved === 1 ? "" : "s"} updated.`
          : "The stored values already matched."
      );
    } catch {
      showError("Could not save", "The panel could not be reached. Your changes are still here.");
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    if (!saved || changes.length === 0) return;
    const ok = await confirm({
      title: "Discard unsaved changes",
      message: `${changes.length} change${
        changes.length === 1 ? "" : "s"
      } across ${affectedScreens.length} screen${
        affectedScreens.length === 1 ? "" : "s"
      } will be reverted to the saved values.`,
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    setDraft({ ...saved });
    setServerErrors({});
    showInfo("Changes discarded", "Every field matches the saved value again.");
  }

  async function resetScreen() {
    const meta = settingsSection(section);
    if (!meta.draftSection || !draft) return;
    const fields = fieldsForSection(meta.draftSection);
    const differing = fields.filter(
      (field) => draft[field.prop] !== field.defaultValue
    );
    if (differing.length === 0) {
      showInfo("Already at defaults", "Every field on this screen has its default value.");
      return;
    }
    const ok = await confirm({
      title: `Reset ${meta.title} to defaults`,
      message: `${differing.length} field${
        differing.length === 1 ? "" : "s"
      } on this screen will be set back to its factory value. Nothing is stored until you press Save changes.`,
      confirmLabel: "Stage defaults",
    });
    if (!ok) return;
    setDraft((previous) => {
      if (!previous) return previous;
      const next = { ...previous } as unknown as Record<string, unknown>;
      for (const field of fields) next[field.prop] = field.defaultValue;
      return next as unknown as PanelSettings;
    });
    if (fields[0]) setHighlightKey(fields[0].key);
    showInfo("Defaults staged", "Press Save changes to apply them.");
  }

  if (!loaded) {
    return (
      <div className="max-w-5xl space-y-4" aria-busy="true">
        <div className="h-7 w-40 animate-pulse rounded bg-bg-tertiary" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((key) => (
            <div
              key={key}
              className="h-28 animate-pulse rounded-xl border border-border bg-bg-card"
            />
          ))}
        </div>
        <p className="text-xs text-text-muted">Loading settings…</p>
      </div>
    );
  }

  if (!saved || !draft) {
    return (
      <Card className="max-w-xl">
        <h3 className="text-lg font-semibold">Settings unavailable</h3>
        <p className="mt-1 text-sm text-text-secondary">
          {loadError ?? "The panel did not return any settings."}
        </p>
        <button type="button" onClick={() => void load()} className={`${BTN.primary} mt-4`}>
          Try again
        </button>
      </Card>
    );
  }

  const meta = settingsSection(section);
  const fieldProps = {
    draft,
    saved,
    errors,
    disabled: saving,
    highlightKey,
    onChange: patch,
  };
  const invalidCount = Object.keys(errors).length;

  return (
    <div className="space-y-6">
      {/* Toolbar — the dashboard header already carries the page title. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[11px] leading-relaxed text-text-muted">
          Draft screens share one <b className="text-text-secondary">Save changes</b>{" "}
          bar at the bottom. Screens marked{" "}
          <Badge tone="neutral">Own save controls</Badge> use their own save or
          apply buttons. Everything here overrides the matching environment
          variables.
        </p>

        <div className="relative w-full sm:w-72">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted"
          >
            🔍
          </span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && searchHits[0]) {
                e.preventDefault();
                openHit(searchHits[0]);
              }
            }}
            placeholder="Find a setting…"
            aria-label="Find a setting"
            className={`${INPUT} pl-9 pr-8`}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-sm text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          )}

          {query.trim() && (
            <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-border bg-bg-card shadow-xl">
              {searchHits.length === 0 ? (
                <p className="px-3 py-2 text-xs text-text-muted">
                  No setting matches “{query.trim()}”.
                </p>
              ) : (
                <ul className="max-h-72 overflow-y-auto">
                  {searchHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => openHit(hit)}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-bg-hover"
                      >
                        <span className="text-sm font-medium">{hit.title}</span>
                        <span className="truncate text-[11px] text-text-muted">
                          {hit.context}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
        {/* Screen picker — pills on phones, a rail on desktop */}
        <div className="-mx-4 overflow-x-auto px-4 pb-1 lg:hidden">
          <div className="flex gap-2">
            {SETTINGS_SECTIONS.map((entry) => {
              const count = changesBySection.counts.get(entry.id) ?? 0;
              const active = entry.id === section;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => selectSection(entry.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-accent/50 bg-accent/15 text-accent"
                      : "border-border bg-bg-card text-text-secondary"
                  }`}
                >
                  <span aria-hidden>{entry.icon}</span>
                  {entry.title}
                  {count > 0 && (
                    <span className="rounded-full bg-accent/20 px-1.5 text-[10px] text-accent">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <nav aria-label="Settings sections" className="hidden lg:block">
          <div className="sticky top-4 space-y-4">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {SETTINGS_SECTIONS.filter((entry) => entry.group === group.id).map(
                    (entry) => {
                      const count = changesBySection.counts.get(entry.id) ?? 0;
                      const invalid = changesBySection.invalid.get(entry.id) ?? 0;
                      const active = entry.id === section;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => selectSection(entry.id)}
                          aria-current={active ? "page" : undefined}
                          title={
                            count > 0
                              ? `${entry.title} — ${count} unsaved change${count === 1 ? "" : "s"}`
                              : entry.title
                          }
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                            active
                              ? "bg-accent/15 font-medium text-accent"
                              : "text-text-secondary hover:bg-bg-hover"
                          }`}
                        >
                          <span aria-hidden>{entry.icon}</span>
                          <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                          {invalid > 0 && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-danger"
                              aria-label={`${invalid} field${invalid === 1 ? "" : "s"} need attention`}
                            />
                          )}
                          {count > 0 && (
                            <span className="rounded-full bg-accent/20 px-1.5 text-[10px] text-accent">
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            ))}
            <p className="px-2 pt-2 text-[10px] leading-relaxed text-text-muted">
              Screens with a <span className="text-accent">number badge</span> have
              staged changes waiting for one shared Save.
            </p>
          </div>
        </nav>

        {/* Active screen */}
        <div ref={contentRef} className="min-w-0 space-y-5 scroll-mt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <span aria-hidden>{meta.icon}</span>
                {meta.title}
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-text-muted">{meta.blurb}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={meta.saveMode === "draft" ? "accent" : "neutral"}>
                {meta.saveMode === "draft"
                  ? "Shared save"
                  : "Own save controls"}
              </Badge>
              {meta.draftSection && (
                <button
                  type="button"
                  onClick={() => void resetScreen()}
                  className={BTN.ghost}
                  title="Stage this screen's factory defaults (nothing is stored until you save)"
                >
                  Reset to defaults
                </button>
              )}
            </div>
          </div>

          {meta.id === "accounts" && (
            <Card>
              <DraftFields section="accounts" {...fieldProps} />
            </Card>
          )}

          {meta.id === "signin" && (
            <>
              <Card>
                <DraftFields section="signin" {...fieldProps} />
              </Card>
              <IpAllowlistBlock />
            </>
          )}

          {meta.id === "retention" && (
            <>
              <Card>
                <RetentionStatsGrid stats={stats} />
                <div className="my-4 border-t border-border" />
                <DraftFields section="retention" {...fieldProps} />
              </Card>
              <DisasterRecoveryBlock />
            </>
          )}

          {meta.id === "automation" && (
            <>
              <Card>
                <DraftFields section="automation" {...fieldProps} />
              </Card>
              <IdleAutoStopBlock />
              <FleetDigestBlock />
            </>
          )}

          {meta.id === "alerts" && (
            <>
              <Card>
                <DraftFields section="alerts" {...fieldProps} />
              </Card>
              <AlertMuteBlock />
            </>
          )}

          {meta.id === "webhook" && <WebhookBlock />}
          {meta.id === "discord" && (
            <DiscordSettings>
              <DiscordBackfillBlock />
            </DiscordSettings>
          )}
          {meta.id === "status" && <PublicStatusBlock />}
        </div>
      </div>

      {/* Shared save bar — only while something is pending. */}
      {(changes.length > 0 || saving || savedFlash) && (
        <div className="sticky bottom-3 z-30">
          <div
            role="status"
            aria-live="polite"
            className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur ${
              changes.length > 0
                ? "border-accent/40 bg-bg-card/95"
                : "border-success/40 bg-bg-card/95"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${
                changes.length > 0 ? "bg-accent" : "bg-success"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {changes.length > 0
                  ? `${changes.length} unsaved change${changes.length === 1 ? "" : "s"}`
                  : "All changes saved"}
              </p>
              <p className="truncate text-[11px] text-text-muted">
                {changes.length > 0
                  ? invalidCount > 0
                    ? `${invalidCount} field${invalidCount === 1 ? "" : "s"} need a valid value first`
                    : `On ${affectedScreens.join(", ")}`
                  : savedAt
                    ? `Saved at ${savedAt.toLocaleTimeString()}`
                    : "Every field matches the stored value"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {changes.length > 0 && (
                <button
                  type="button"
                  onClick={() => void discard()}
                  disabled={saving}
                  className={BTN.secondary}
                >
                  Discard
                </button>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || changes.length === 0}
                className={BTN.success}
              >
                {saving
                  ? "Saving…"
                  : changes.length > 0
                    ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`
                    : "Saved"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Row counts give the retention windows context. */
function RetentionStatsGrid({ stats }: { stats: RetentionStats | null }) {
  if (!stats) return null;
  const entries: Array<[string, number]> = [
    ["Node metric rows", stats.nodeMetrics],
    ["Server metric rows", stats.serverMetrics],
    ["Audit entries", stats.auditLog],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {entries.map(([label, value]) => (
        <div
          key={label}
          className="rounded-lg border border-border bg-bg-secondary/60 p-3 text-center"
        >
          <div className="text-lg font-semibold">{value.toLocaleString()}</div>
          <div className="text-[11px] text-text-muted">{label}</div>
        </div>
      ))}
      <p className="text-[11px] text-text-muted sm:col-span-3">
        Pruning runs in the background. A busy five-node panel writes roughly
        43,000 metric rows a day.
      </p>
    </div>
  );
}

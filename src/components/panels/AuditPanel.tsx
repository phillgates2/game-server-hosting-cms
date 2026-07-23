"use client";

import { useState, useCallback } from "react";

interface ArtifactResult { artifact: string; found: boolean }
interface LiveCheck { serverId: number; serverName: string; installPath: string; artifactResults: ArtifactResult[]; allFound: boolean; fileCount: number; totalSizeMb: number }
interface AuditResult {
  slug: string; name: string; icon: string; category: string;
  source: string; installMethod: string; expectedArtifacts: string[];
  startBinary: string; issues: string[]; warnings: string[];
  ok: boolean; liveChecks?: LiveCheck[];
}
interface Summary { total: number; ok: number; issues: number; warnings: number; withLiveChecks: number; liveAllPassed: number; liveSomeFailed: number }

export default function AuditPanel() {
  const [results, setResults] = useState<AuditResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "issues" | "warnings" | "live">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/audit/templates");
      const data = await res.json();
      setResults(data.results || []);
      setSummary(data.summary || null);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const filtered = results.filter((r) => {
    if (filter === "issues") return !r.ok;
    if (filter === "warnings") return r.warnings.length > 0;
    if (filter === "live") return r.liveChecks && r.liveChecks.length > 0;
    return true;
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🔍 Template Audit</h2>
          <p className="text-text-secondary text-sm">Verify all game templates have correct binaries, scripts, and install artifacts</p>
        </div>
        <button onClick={runAudit} disabled={loading} className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg text-sm font-medium">
          {loading ? "Auditing..." : "▶ Run Audit"}
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <SumCard label="Total" value={summary.total} color="text-text-primary" />
          <SumCard label="Passed" value={summary.ok} color="text-success" />
          <SumCard label="Issues" value={summary.issues} color="text-danger" />
          <SumCard label="Warnings" value={summary.warnings} color="text-warning" />
          <SumCard label="Live Checks" value={summary.withLiveChecks} color="text-accent" />
          <SumCard label="Live OK" value={summary.liveAllPassed} color="text-success" />
          <SumCard label="Live Failed" value={summary.liveSomeFailed} color="text-danger" />
        </div>
      )}

      {/* Filters */}
      {results.length > 0 && (
        <div className="flex gap-2">
          {(["all", "issues", "warnings", "live"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"}`}>
              {f === "all" ? `All (${results.length})` : f === "issues" ? `Issues (${results.filter((r) => !r.ok).length})` : f === "warnings" ? `Warnings (${results.filter((r) => r.warnings.length > 0).length})` : `Live (${results.filter((r) => r.liveChecks && r.liveChecks.length > 0).length})`}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div key={r.slug} className={`bg-bg-card border rounded-xl overflow-hidden transition-colors ${!r.ok ? "border-danger/40" : r.warnings.length > 0 ? "border-warning/30" : "border-border"}`}>
              {/* Header */}
              <button onClick={() => setExpanded(expanded === r.slug ? null : r.slug)} className="w-full text-left p-4 flex items-center gap-4 hover:bg-bg-hover transition-colors">
                <span className="text-2xl">{r.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{r.name}</span>
                    <span className="text-[10px] font-mono text-text-muted">{r.slug}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
                      {r.ok ? "✓ Pass" : "✗ Issues"}
                    </span>
                    {r.warnings.length > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/15 text-warning">{r.warnings.length} warning{r.warnings.length > 1 ? "s" : ""}</span>}
                    {r.liveChecks && r.liveChecks.length > 0 && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.liveChecks.every((l) => l.allFound) ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
                        Live: {r.liveChecks.filter((l) => l.allFound).length}/{r.liveChecks.length}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-text-muted">
                    <span>{r.category}</span>
                    <span>{r.installMethod}</span>
                    <span>Binary: <code className="text-accent">{r.startBinary}</code></span>
                    <span>{r.source}</span>
                  </div>
                </div>
                <span className="text-text-muted text-xs">{expanded === r.slug ? "▼" : "▶"}</span>
              </button>

              {/* Detail */}
              {expanded === r.slug && (
                <div className="border-t border-border p-4 space-y-4 bg-bg-secondary/30">
                  {/* Expected artifacts */}
                  <div>
                    <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">Expected Runtime Artifacts</h4>
                    {r.expectedArtifacts.length === 0 ? (
                      <p className="text-xs text-text-muted italic">No explicit artifacts defined</p>
                    ) : (
                      <div className="space-y-1">
                        {r.expectedArtifacts.map((a) => (
                          <div key={a} className="flex items-center gap-2 text-xs font-mono bg-bg-secondary rounded px-2 py-1">
                            <span className="text-accent">{a}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Issues */}
                  {r.issues.length > 0 && (
                    <div>
                      <h4 className="text-xs text-danger uppercase tracking-wider mb-2">Issues</h4>
                      <div className="space-y-1">
                        {r.issues.map((issue, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-danger bg-danger/5 rounded px-3 py-2">
                            <span>❌</span><span>{issue}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {r.warnings.length > 0 && (
                    <div>
                      <h4 className="text-xs text-warning uppercase tracking-wider mb-2">Warnings</h4>
                      <div className="space-y-1">
                        {r.warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-warning bg-warning/5 rounded px-3 py-2">
                            <span>⚠️</span><span>{w}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Live checks */}
                  {r.liveChecks && r.liveChecks.length > 0 && (
                    <div>
                      <h4 className="text-xs text-accent uppercase tracking-wider mb-2">Live Server Verification</h4>
                      <div className="space-y-3">
                        {r.liveChecks.map((lc) => (
                          <div key={lc.serverId} className={`border rounded-lg p-3 ${lc.allFound ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <span className="font-medium text-sm">{lc.serverName}</span>
                                <span className="text-xs text-text-muted ml-2 font-mono">{lc.installPath}</span>
                              </div>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${lc.allFound ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
                                {lc.allFound ? "✓ All found" : "✗ Missing files"}
                              </span>
                            </div>
                            <div className="space-y-1">
                              {lc.artifactResults.map((ar) => (
                                <div key={ar.artifact} className="flex items-center gap-2 text-xs font-mono">
                                  <span className={ar.found ? "text-success" : "text-danger"}>{ar.found ? "✓" : "✗"}</span>
                                  <span className={ar.found ? "text-text-secondary" : "text-danger"}>{ar.artifact}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-4 mt-2 text-[10px] text-text-muted">
                              <span>{lc.fileCount} files in root</span>
                              <span>{lc.totalSizeMb} MB</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !loading && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">🔍</span>
          <h3 className="font-semibold mb-1">No audit results</h3>
          <p className="text-text-secondary text-sm">Click &quot;Run Audit&quot; to verify all game templates</p>
        </div>
      )}
    </div>
  );
}

function SumCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-lg p-3 text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </div>
  );
}

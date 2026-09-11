"use client";

/**
 * A tiny dependency-free SVG line chart for metric history.
 *
 * The panel deliberately avoids chart libraries: this renders a polyline plus
 * a soft area fill from an array of `{ t, v }` points, with first/last time
 * labels and the current value. That is everything a "CPU/RAM over time"
 * graph needs, at zero bundle cost and with nothing external to load.
 */

import { useId } from "react";
import type { MetricPoint } from "@/lib/metrics-history";

interface Props {
  points: MetricPoint[];
  color: string;
  label: string;
  unit: string;
  height?: number;
}

function formatTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MetricsChart({ points, color, label, unit, height = 120 }: Props) {
  const gradientId = useId();
  const W = 600;
  const H = height;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 8;

  if (points.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary/60 p-3">
        <p className="text-xs font-medium text-text-secondary">{label}</p>
        <div
          className="flex items-center justify-center text-[11px] text-text-muted"
          style={{ height }}
        >
          No samples in this window — samples are recorded while the server runs.
        </div>
      </div>
    );
  }

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const spanT = Math.max(1, t1 - t0);

  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  // A flat line would divide by zero; give it an arbitrary band. CPU is a
  // percentage, so 0–100 is also the most useful flat view.
  if (max - min < 1e-9) {
    min = Math.max(0, min - 5);
    max = max + 5;
  }
  const spanV = max - min;

  const x = (t: number) => ((t - t0) / spanT) * W;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / spanV) * (H - PAD_TOP - PAD_BOTTOM);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  const last = points[points.length - 1];

  return (
    <div className="rounded-lg border border-border bg-bg-secondary/60 p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-xs font-medium text-text-secondary">{label}</p>
        <p className="text-sm font-semibold" style={{ color }}>
          {last.v.toLocaleString()}{unit}
          <span className="ml-1 text-[10px] font-normal text-text-muted">
            peak {max.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}
          </span>
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${label} history`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* quarter lines: orientation without axis clutter */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={PAD_TOP + f * (H - PAD_TOP - PAD_BOTTOM)}
            y2={PAD_TOP + f * (H - PAD_TOP - PAD_BOTTOM)}
            stroke="currentColor"
            strokeOpacity="0.08"
            strokeWidth="1"
          />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-text-muted">
        <span>{formatTime(t0)}</span>
        <span>min {min.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}</span>
        <span>{formatTime(t1)}</span>
      </div>
    </div>
  );
}

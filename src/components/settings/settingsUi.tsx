"use client";

import type { ReactNode } from "react";
import {
  clampPanelSettingValue,
  type PanelSettingField,
} from "@/lib/panel-settings";

/**
 * Shared building blocks for the settings screens.
 *
 * Keeping the markup for a labelled field in one place is what makes the
 * screen consistent: every input gets the same changed-marker, the same error
 * styling, the same aria wiring, and the same "use the nearest legal value"
 * escape hatch.
 */

export const CARD =
  "bg-bg-card border border-border rounded-xl p-4 sm:p-6 space-y-5";

export const INPUT =
  "w-full px-3 py-2 gaming-chip rounded-lg text-sm bg-bg-secondary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50";

export const BTN = {
  primary:
    "px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors",
  success:
    "px-4 py-2 rounded-lg text-sm font-medium bg-success text-white hover:opacity-90 disabled:opacity-40 transition-colors",
  secondary:
    "px-4 py-2 rounded-lg text-sm font-medium bg-bg-tertiary text-text-secondary border border-border hover:bg-bg-hover disabled:opacity-40 transition-colors",
  ghost:
    "px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 transition-colors",
  danger:
    "px-4 py-2 rounded-lg text-sm font-medium bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 disabled:opacity-40 transition-colors",
} as const;

/** A small status pill, used for "Saves instantly" and similar notes. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "accent";
}) {
  const tones = {
    neutral: "bg-bg-tertiary text-text-muted border-border",
    success: "bg-success/15 text-success border-success/30",
    warning: "bg-warning/15 text-warning border-warning/30",
    accent: "bg-accent/15 text-accent border-accent/30",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Marks a field whose value differs from what is stored on the server. */
export function ChangedMarker({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      <span aria-label={`${label} has an unsaved change`}>Unsaved</span>
    </span>
  );
}

/** The card every settings screen sits in. */
export function SectionCard({
  id,
  icon,
  title,
  description,
  actions,
  children,
}: {
  id?: string;
  icon?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-heading` : undefined}
      className={CARD}
      tabIndex={-1}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id={id ? `${id}-heading` : undefined}
            className="flex items-center gap-2 text-lg font-semibold"
          >
            {icon && <span aria-hidden>{icon}</span>}
            {title}
          </h3>
          {description && (
            <p className="mt-1 max-w-2xl text-xs text-text-muted">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </header>
      {children}
    </section>
  );
}

/** A plain card, for content that brings its own heading. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${CARD} ${className}`}>{children}</div>;
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

/**
 * A numeric setting.
 *
 * The value may be `NaN` while the operator is mid-edit (they cleared the box),
 * which renders as empty and validates as "enter a whole number" — rather than
 * the old behaviour of quietly becoming 0 and being saved as a deliberate zero.
 */
export function NumberField({
  field,
  value,
  savedValue,
  error,
  disabled,
  highlighted,
  onChange,
}: {
  field: PanelSettingField;
  value: number;
  savedValue: number;
  error: string | null;
  disabled?: boolean;
  highlighted?: boolean;
  onChange: (value: number) => void;
}) {
  const id = `field-${field.key}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const nearest = Number.isFinite(value)
    ? clampPanelSettingValue(field.key, value)
    : null;
  const showNearest = Boolean(error) && nearest !== null && nearest !== value;

  return (
    <div
      id={`setting-${field.key}`}
      className={
        highlighted
          ? "rounded-lg ring-2 ring-accent/60 ring-offset-2 ring-offset-bg-card"
          : undefined
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="block text-xs font-medium text-text-secondary"
        >
          {field.label}
        </label>
        <ChangedMarker show={value !== savedValue} label={field.label} />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          step={1}
          min={field.min}
          max={field.max}
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          onChange={(e) =>
            onChange(e.target.value.trim() === "" ? Number.NaN : Number(e.target.value))
          }
          // A focused number input changes under the mouse wheel; stepping a
          // session length by scrolling past it is never what was intended.
          onWheel={(e) => {
            if (document.activeElement === e.currentTarget) e.currentTarget.blur();
          }}
          className={`${INPUT} ${
            error ? "border-danger focus:ring-danger/40" : ""
          }`}
        />
        {field.unit && (
          <span className="whitespace-nowrap text-xs text-text-muted">
            {field.unit}
          </span>
        )}
      </div>
      <p id={hintId} className="mt-1 text-[11px] text-text-muted">
        {field.hint}
        {field.kind === "number" &&
          field.min !== undefined &&
          field.max !== undefined &&
          field.min !== 0 && (
            <span className="text-text-muted/80">
              {" "}
              ({field.min}–{field.max})
            </span>
          )}
      </p>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium text-danger"
        >
          {error}
          {showNearest && (
            <button
              type="button"
              onClick={() => onChange(nearest)}
              className="underline decoration-dotted underline-offset-2 hover:text-danger/80"
            >
              Use {nearest}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * A boolean setting.
 *
 * One button, not a checkbox plus a label: the whole row is the control, so it
 * works with a mouse, a finger and a screen reader without a stray click target.
 */
export function ToggleField({
  field,
  value,
  savedValue,
  error,
  disabled,
  highlighted,
  onChange,
}: {
  field: PanelSettingField;
  value: boolean;
  savedValue: boolean;
  error: string | null;
  disabled?: boolean;
  highlighted?: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = `field-${field.key}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div
      id={`setting-${field.key}`}
      className={`${
        highlighted
          ? "rounded-lg ring-2 ring-accent/60 ring-offset-2 ring-offset-bg-card"
          : ""
      }`}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
          value
            ? "border-accent/40 bg-accent/5 hover:border-accent/60"
            : "border-border bg-bg-secondary/40 hover:border-accent/40"
        }`}
      >
        <span
          aria-hidden
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
            value ? "bg-success" : "bg-bg-hover"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              value ? "left-[18px]" : "left-0.5"
            }`}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{field.label}</span>
            <Badge tone={value ? "success" : "neutral"}>
              {value ? "On" : "Off"}
            </Badge>
            <ChangedMarker show={value !== savedValue} label={field.label} />
          </span>
          <span
            id={hintId}
            className="mt-0.5 block text-[11px] text-text-muted"
          >
            {field.hint}
          </span>
          {error && (
            <span
              id={errorId}
              className="mt-1 block text-[11px] font-medium text-danger"
            >
              {error}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

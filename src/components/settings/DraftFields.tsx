"use client";

import {
  PANEL_SETTING_FIELDS,
  fieldsForSection,
  type PanelSettingKey,
  type PanelSettings,
  type PanelSettingsSection,
} from "@/lib/panel-settings";
import { FieldGrid, NumberField, ToggleField } from "./settingsUi";

export interface DraftFieldProps {
  draft: PanelSettings;
  saved: PanelSettings;
  /** Per-column error messages, already merged from client and server. */
  errors: Record<string, string>;
  disabled?: boolean;
  highlightKey: string | null;
  onChange: (prop: keyof PanelSettings, value: number | boolean) => void;
}

/**
 * Render every setting on a screen straight from the registry.
 *
 * Because the fields are data, a screen cannot forget one, cannot give an input
 * a different bound from the API, and a new setting only has to be described
 * once to appear here in the right place with the right help text.
 */
export function DraftFields({
  section,
  ...props
}: DraftFieldProps & { section: PanelSettingsSection }) {
  const fields = fieldsForSection(section);
  const toggles = fields.filter((field) => field.kind === "boolean");
  const numbers = fields.filter((field) => field.kind === "number");

  return (
    <div className="space-y-4">
      {toggles.map((field) => (
        <ToggleField
          key={field.key}
          field={field}
          value={Boolean(props.draft[field.prop])}
          savedValue={Boolean(props.saved[field.prop])}
          error={props.errors[field.key] ?? null}
          disabled={props.disabled}
          highlighted={props.highlightKey === field.key}
          onChange={(value) => props.onChange(field.prop, value)}
        />
      ))}
      {numbers.length > 0 && (
        <FieldGrid>
          {numbers.map((field) => (
            <NumberField
              key={field.key}
              field={field}
              value={Number(props.draft[field.prop])}
              savedValue={Number(props.saved[field.prop])}
              error={props.errors[field.key] ?? null}
              disabled={props.disabled}
              highlighted={props.highlightKey === field.key}
              onChange={(value) => props.onChange(field.prop, value)}
            />
          ))}
        </FieldGrid>
      )}
    </div>
  );
}

/** Keys belonging to a screen, for the "reset these fields" action. */
export function sectionFieldKeys(section: PanelSettingsSection): PanelSettingKey[] {
  return fieldsForSection(section).map((field) => field.key);
}

/** The registry entry for a key, if it exists. */
export function fieldFor(key: string) {
  return key in PANEL_SETTING_FIELDS ? PANEL_SETTING_FIELDS[key as PanelSettingKey] : null;
}

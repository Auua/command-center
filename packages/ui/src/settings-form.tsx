'use client';

import type { ReactElement } from 'react';
import type { SettingsField } from './settings-schema';

export type SettingsValues = Record<string, unknown>;

interface SettingsFormProps {
  fields: SettingsField[];
  values: SettingsValues;
  onChange: (name: string, value: unknown) => void;
  /** Human label per field name; falls back to the field name. */
  labelFor?: (name: string) => string;
  /** Copy for a field the panel cannot render. */
  unsupportedText: string;
  /** `id` prefix so several forms on one page never collide. */
  idPrefix: string;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Renders a settings form from `describeSettingsSchema()` output. Purely
 * controlled: the caller owns the values and validates with the widget's
 * schema on save. Uses the shell's `.cc-field` form vocabulary.
 */
export function SettingsForm({
  fields,
  values,
  onChange,
  labelFor = (name: string): string => name,
  unsupportedText,
  idPrefix,
}: SettingsFormProps): ReactElement {
  return (
    <div className="cc-settings-form">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const label = labelFor(field.name);
        const value = values[field.name];

        switch (field.kind) {
          case 'boolean':
            return (
              <label key={field.name} className="cc-field cc-field-check" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(value ?? field.defaultValue ?? false)}
                  onChange={(event) => onChange(field.name, event.target.checked)}
                />
                <span className="cc-field-label">{label}</span>
              </label>
            );
          case 'enum':
            return (
              <label key={field.name} className="cc-field" htmlFor={id}>
                <span className="cc-field-label">{label}</span>
                <select
                  id={id}
                  value={String(value ?? field.defaultValue ?? field.options[0] ?? '')}
                  onChange={(event) => onChange(field.name, event.target.value)}
                >
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            );
          case 'number':
            return (
              <label key={field.name} className="cc-field" htmlFor={id}>
                <span className="cc-field-label">{label}</span>
                <input
                  id={id}
                  type="number"
                  inputMode={field.integer ? 'numeric' : 'decimal'}
                  min={field.min}
                  max={field.max}
                  step={field.integer ? 1 : 'any'}
                  value={value === undefined || value === null ? '' : String(value)}
                  onChange={(event) => {
                    const raw = event.target.value;
                    onChange(field.name, raw === '' ? undefined : Number(raw));
                  }}
                />
              </label>
            );
          case 'string':
            return (
              <label key={field.name} className="cc-field" htmlFor={id}>
                <span className="cc-field-label">{label}</span>
                <input
                  id={id}
                  type="text"
                  value={String(value ?? '')}
                  onChange={(event) => onChange(field.name, event.target.value)}
                />
              </label>
            );
          case 'string-list':
            return (
              <label key={field.name} className="cc-field" htmlFor={id}>
                <span className="cc-field-label">{label}</span>
                <input
                  id={id}
                  type="text"
                  value={asStringList(value).join(', ')}
                  onChange={(event) =>
                    onChange(
                      field.name,
                      event.target.value
                        .split(',')
                        .map((item) => item.trim())
                        .filter((item) => item.length > 0),
                    )
                  }
                />
              </label>
            );
          case 'enum-list': {
            const selected = new Set(asStringList(value));
            return (
              <fieldset key={field.name} className="cc-field cc-segmented">
                <legend className="cc-field-label">{label}</legend>
                {field.options.map((option) => (
                  <label key={option}>
                    <input
                      type="checkbox"
                      checked={selected.has(option)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(option);
                        else next.delete(option);
                        onChange(
                          field.name,
                          field.options.filter((candidate) => next.has(candidate)),
                        );
                      }}
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
            );
          }
          default:
            return (
              <p key={field.name} className="cc-field cc-field-unsupported">
                <span className="cc-field-label">{label}</span>
                <span>{unsupportedText}</span>
              </p>
            );
        }
      })}
    </div>
  );
}

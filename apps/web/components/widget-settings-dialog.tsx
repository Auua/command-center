'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  SettingsForm,
  type AnyWidgetDefinition,
  type SettingsField,
  type SettingsValues,
} from '@command-center/ui';
import { t } from '@/lib/i18n';
import { settingsFieldLabel } from '@/lib/i18n/settings-labels';

interface WidgetSettingsDialogProps {
  definition: AnyWidgetDefinition;
  fields: SettingsField[];
  /** The validated settings currently in effect. */
  current: SettingsValues;
  saving: boolean;
  error: string | null;
  onSave: (settings: SettingsValues) => void;
  onClose: () => void;
}

/**
 * The auto-generated settings panel (ADR §4.2): a native `<dialog>` (the
 * builder modal's pattern) around a form rendered from the widget's zod
 * schema. Save re-validates with that schema so the panel can never persist
 * a value the widget would reject on read.
 */
export function WidgetSettingsDialog({
  definition,
  fields,
  current,
  saving,
  error,
  onSave,
  onClose,
}: WidgetSettingsDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<SettingsValues>(() => ({ ...current }));
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const parsed = definition.settingsSchema.safeParse(values);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setValidationError(
        t('settings.invalid', {
          field: first ? settingsFieldLabel(definition.id, String(first.path[0] ?? '')) : '',
          reason: first?.message ?? '',
        }),
      );
      return;
    }
    setValidationError(null);
    onSave(parsed.data as SettingsValues);
  };

  const titleId = `settings-${definition.id}-title`;

  return (
    <dialog
      ref={dialogRef}
      className="cc-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="cc-dialog-title">
        {t('settings.title', { title: definition.title })}
      </h2>
      <form onSubmit={handleSubmit} noValidate>
        <div className="cc-dialog-body">
          <SettingsForm
            fields={fields}
            values={values}
            onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
            labelFor={(name) => settingsFieldLabel(definition.id, name)}
            unsupportedText={t('settings.unsupported')}
            idPrefix={`settings-${definition.id}`}
          />
        </div>
        {(validationError ?? error) && (
          <p className="cc-form-error" role="alert">
            {validationError ?? error}
          </p>
        )}
        <div className="cc-dialog-footer">
          <button type="button" className="cc-btn cc-btn-ghost" onClick={onClose} disabled={saving}>
            {t('settings.cancel')}
          </button>
          <span className="cc-dialog-footer-spacer" />
          <button type="submit" className="cc-btn" disabled={saving} aria-busy={saving}>
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

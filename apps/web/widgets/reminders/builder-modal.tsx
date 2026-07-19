'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
} from 'react';
import {
  AutomationActionSchema,
  EVENT_KEYS,
  type Automation,
  type AutomationAction,
  type AutomationRunStatus,
  type CreateAutomationRequest,
  type EventKey,
  type Schedule,
  type UpdateAutomationRequest,
} from '@command-center/contracts';
import {
  createAutomation,
  deleteAutomation,
  fetchAutomationRuns,
  fetchAutomations,
  updateAutomation,
} from '@/lib/automations-api';
import { t } from '@/lib/i18n';
import { describeSchedule, formatInstantTime, isoWeekdayShortNames } from './time-format';
import {
  formFromSchedule,
  scheduleFromForm,
  type DayChoice,
  type TimedScheduleForm,
} from './schedule-from-form';

/**
 * The automation builder (ADR-015): a native `<dialog>` modal — focus trap,
 * Esc and top-layer come free. Cron never appears; the form edits the
 * structured Schedule descriptor via schedule-from-form.ts. The action is
 * fixed notify-only v1 copy rendered as static text, with the lock-screen
 * warning (§5.2). Esc/Cancel confirm first when the form is dirty
 * (ADR-018's dialog rule); focus returns to the invoker (handled by the
 * widget, which owns the invoker element).
 */

interface BuilderModalProps {
  mode: 'create' | 'edit';
  /** Required in edit mode. */
  automationId?: string;
  onClose: () => void;
}

interface BuilderFormState {
  name: string;
  whenKind: 'time' | 'event';
  time: string;
  dayChoice: DayChoice;
  customDays: number[];
  eventKey: EventKey;
  title: string;
  body: string;
}

function initialFormState(automation?: Automation): BuilderFormState {
  if (!automation) {
    return {
      name: '',
      whenKind: 'time',
      time: '12:00',
      dayChoice: 'every-day',
      customDays: [],
      eventKey: EVENT_KEYS[0],
      title: '',
      body: '',
    };
  }
  const timedForm: TimedScheduleForm | null = automation.schedule
    ? formFromSchedule(automation.schedule)
    : null;
  return {
    name: automation.name,
    whenKind: automation.kind === 'event' ? 'event' : 'time',
    time: timedForm?.time ?? '12:00',
    dayChoice: timedForm?.dayChoice ?? 'every-day',
    customDays: timedForm?.customDays ?? [],
    eventKey: automation.eventKey ?? EVENT_KEYS[0],
    title: automation.action.title,
    body: automation.action.body ?? '',
  };
}

function eventKeyLabel(key: EventKey): string {
  switch (key) {
    case 'task.completed':
      return t('reminders.eventKey.taskCompleted');
  }
}

export function BuilderModal({ mode, automationId, onClose }: BuilderModalProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const requestClose = useCallback((): void => {
    if (dirtyRef.current && !window.confirm(t('builder.discardConfirm'))) {
      return;
    }
    onClose();
  }, [onClose]);

  const listQuery = useQuery({
    queryKey: ['automations', 'list'],
    queryFn: fetchAutomations,
    enabled: mode === 'edit',
  });
  const automation =
    mode === 'edit' ? listQuery.data?.items.find((item) => item.id === automationId) : undefined;
  const editReady = mode === 'edit' && automation !== undefined;

  return (
    <dialog
      ref={dialogRef}
      className="cc-dialog"
      aria-label={mode === 'create' ? t('builder.titleNew') : t('builder.titleEdit')}
      onCancel={(event) => {
        // Esc: route through the dirty-confirm path instead of closing.
        event.preventDefault();
        requestClose();
      }}
    >
      <h2 className="cc-dialog-title">
        {mode === 'create' ? t('builder.titleNew') : t('builder.titleEdit')}
      </h2>
      {mode === 'edit' && !editReady ? (
        <div className="cc-dialog-body">
          {listQuery.isError ? (
            <p role="alert" className="cc-rem-error">
              {t('builder.error.save')}
            </p>
          ) : (
            <p role="status">{t('builder.loading')}</p>
          )}
          <div className="cc-dialog-footer">
            <button type="button" className="cc-btn cc-btn-ghost" onClick={onClose}>
              {t('builder.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <BuilderForm
          mode={mode}
          automation={automation}
          dirtyRef={dirtyRef}
          requestClose={requestClose}
          onDone={onClose}
        />
      )}
    </dialog>
  );
}

interface BuilderFormProps {
  mode: 'create' | 'edit';
  automation?: Automation;
  dirtyRef: MutableRefObject<boolean>;
  /** Cancel path — confirms when dirty. */
  requestClose: () => void;
  /** Saved/deleted path — closes without confirming. */
  onDone: () => void;
}

interface SaveRequest {
  create?: CreateAutomationRequest;
  update?: UpdateAutomationRequest;
}

type BuildResult = ({ ok: true } & SaveRequest) | { ok: false; message: string };

function BuilderForm({
  mode,
  automation,
  dirtyRef,
  requestClose,
  onDone,
}: BuilderFormProps): ReactElement {
  const queryClient = useQueryClient();
  const initial = useRef(initialFormState(automation));
  const [form, setForm] = useState<BuilderFormState>(initial.current);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'activity'>('details');

  dirtyRef.current = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial.current),
    [form],
  );

  const intervalSchedule: Schedule | null =
    automation?.schedule?.type === 'interval' ? automation.schedule : null;

  const patch = <K extends keyof BuilderFormState>(key: K, value: BuilderFormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['automations'] });

  const saveMutation = useMutation({
    mutationFn: async (request: SaveRequest) => {
      if (request.create) return createAutomation(request.create);
      if (request.update && automation) return updateAutomation(automation.id, request.update);
      throw new Error('nothing to save');
    },
    onSuccess: async () => {
      await invalidate();
      dirtyRef.current = false;
      onDone();
    },
    onError: () => setFormError(t('builder.error.save')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: async () => {
      await invalidate();
      dirtyRef.current = false;
      onDone();
    },
    onError: () => setFormError(t('builder.error.save')),
  });

  function buildRequest(): BuildResult {
    const name = form.name.trim();
    if (!name) return { ok: false, message: t('builder.error.name') };

    const actionParse = AutomationActionSchema.safeParse({
      type: 'notify',
      title: form.title.trim() || name,
      body: form.body.trim() ? form.body.trim() : null,
    });
    if (!actionParse.success) return { ok: false, message: t('builder.error.title') };
    const action: AutomationAction = actionParse.data;

    if (form.whenKind === 'event') {
      if (mode === 'create') {
        return {
          ok: true,
          create: { name, kind: 'event', eventKey: form.eventKey, action, enabled: true },
        };
      }
      return { ok: true, update: { name, eventKey: form.eventKey, action } };
    }

    // Timed. Interval schedules are read-only in the v1 builder: PATCH
    // without a schedule leaves them untouched.
    if (intervalSchedule) {
      return { ok: true, update: { name, action } };
    }
    const scheduleResult = scheduleFromForm({
      time: form.time,
      dayChoice: form.dayChoice,
      customDays: form.customDays,
    });
    if (!scheduleResult.ok) {
      return {
        ok: false,
        message:
          scheduleResult.error === 'invalid-time'
            ? t('builder.error.time')
            : t('builder.error.days'),
      };
    }
    if (mode === 'create') {
      return {
        ok: true,
        create: {
          name,
          kind: 'recurring',
          schedule: scheduleResult.schedule,
          action,
          enabled: true,
        },
      };
    }
    return { ok: true, update: { name, schedule: scheduleResult.schedule, action } };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saveMutation.isPending || deleteMutation.isPending) return;
    const request = buildRequest();
    if (!request.ok) {
      setFormError(request.message);
      return;
    }
    setFormError(null);
    saveMutation.mutate(request);
  }

  function handleDelete(): void {
    if (!automation || deleteMutation.isPending) return;
    if (!window.confirm(t('builder.deleteConfirm', { name: automation.name }))) return;
    deleteMutation.mutate(automation.id);
  }

  function handleTabKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setTab((current) => (current === 'details' ? 'activity' : 'details'));
    }
  }

  const weekdayNames = isoWeekdayShortNames();
  const busy = saveMutation.isPending || deleteMutation.isPending;

  return (
    <div className="cc-dialog-body">
      {mode === 'edit' && automation && (
        <div
          role="tablist"
          aria-label={t('builder.titleEdit')}
          className="cc-tabs"
          onKeyDown={handleTabKey}
        >
          <button
            type="button"
            role="tab"
            id="cc-builder-tab-details"
            aria-selected={tab === 'details'}
            aria-controls="cc-builder-panel-details"
            tabIndex={tab === 'details' ? 0 : -1}
            onClick={() => setTab('details')}
          >
            {t('builder.tab.details')}
          </button>
          <button
            type="button"
            role="tab"
            id="cc-builder-tab-activity"
            aria-selected={tab === 'activity'}
            aria-controls="cc-builder-panel-activity"
            tabIndex={tab === 'activity' ? 0 : -1}
            onClick={() => setTab('activity')}
          >
            {t('builder.tab.activity')}
          </button>
        </div>
      )}

      {tab === 'activity' && automation ? (
        <div
          role="tabpanel"
          id="cc-builder-panel-activity"
          aria-labelledby="cc-builder-tab-activity"
        >
          <ActivityPanel automationId={automation.id} />
          <div className="cc-dialog-footer">
            <button type="button" className="cc-btn cc-btn-ghost" onClick={requestClose}>
              {t('builder.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          role={mode === 'edit' ? 'tabpanel' : undefined}
          id={mode === 'edit' ? 'cc-builder-panel-details' : undefined}
          aria-labelledby={mode === 'edit' ? 'cc-builder-tab-details' : undefined}
        >
          {formError && (
            <p role="alert" className="cc-rem-error">
              {formError}
            </p>
          )}

          <label className="cc-field">
            <span className="cc-field-label">{t('builder.name')}</span>
            <input
              type="text"
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => patch('name', event.target.value)}
            />
          </label>

          <fieldset className="cc-field cc-segmented" disabled={mode === 'edit'}>
            {/* kind is immutable after creation (contract rule). */}
            <legend className="cc-field-label">{t('builder.when.legend')}</legend>
            <label>
              <input
                type="radio"
                name="cc-builder-when"
                checked={form.whenKind === 'time'}
                onChange={() => patch('whenKind', 'time')}
              />
              <span>{t('builder.when.time')}</span>
            </label>
            <label>
              <input
                type="radio"
                name="cc-builder-when"
                checked={form.whenKind === 'event'}
                onChange={() => patch('whenKind', 'event')}
              />
              <span>{t('builder.when.event')}</span>
            </label>
          </fieldset>

          {form.whenKind === 'time' ? (
            intervalSchedule ? (
              <p className="cc-widget-placeholder">
                {t('builder.interval.note', { summary: describeSchedule(intervalSchedule) })}
              </p>
            ) : (
              <>
                <label className="cc-field">
                  <span className="cc-field-label">{t('builder.time')}</span>
                  <input
                    type="time"
                    required
                    value={form.time}
                    onChange={(event) => patch('time', event.target.value)}
                  />
                </label>
                <fieldset className="cc-field cc-segmented">
                  <legend className="cc-field-label">{t('builder.days.legend')}</legend>
                  {(
                    [
                      ['every-day', t('builder.days.everyDay')],
                      ['weekdays', t('builder.days.weekdays')],
                      ['weekends', t('builder.days.weekends')],
                      ['custom', t('builder.days.custom')],
                    ] as const
                  ).map(([choice, label]) => (
                    <label key={choice}>
                      <input
                        type="radio"
                        name="cc-builder-days"
                        checked={form.dayChoice === choice}
                        onChange={() => patch('dayChoice', choice)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
                {form.dayChoice === 'custom' && (
                  <fieldset className="cc-field cc-day-chips">
                    <legend className="cc-visually-hidden">{t('builder.days.custom')}</legend>
                    {weekdayNames.map((dayName, index) => {
                      const day = index + 1;
                      const checked = form.customDays.includes(day);
                      return (
                        <label key={day} className="cc-day-chip">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              patch(
                                'customDays',
                                checked
                                  ? form.customDays.filter((value) => value !== day)
                                  : [...form.customDays, day],
                              )
                            }
                          />
                          <span>{dayName}</span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}
              </>
            )
          ) : (
            <label className="cc-field">
              <span className="cc-field-label">{t('builder.eventLabel')}</span>
              <select
                value={form.eventKey}
                onChange={(event) => patch('eventKey', event.target.value as EventKey)}
              >
                {EVENT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {eventKeyLabel(key)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="cc-field">
            {/* v1 is notify-only (§5.3): static text, not a fake dropdown. */}
            <span className="cc-field-label">{t('builder.actionLabel')}</span>
            <p className="cc-builder-action-static">{t('builder.actionStatic')}</p>
          </div>

          <label className="cc-field">
            <span className="cc-field-label">{t('builder.notificationTitle')}</span>
            <input
              type="text"
              maxLength={80}
              value={form.title}
              placeholder={t('builder.notificationTitleHint')}
              onChange={(event) => patch('title', event.target.value)}
            />
          </label>
          <label className="cc-field">
            <span className="cc-field-label">{t('builder.notificationBody')}</span>
            <textarea
              maxLength={200}
              rows={2}
              value={form.body}
              onChange={(event) => patch('body', event.target.value)}
            />
          </label>
          <p className="cc-builder-lock-warning">{t('builder.lockScreenWarning')}</p>

          <div className="cc-dialog-footer">
            {mode === 'edit' && automation && (
              <button
                type="button"
                className="cc-btn cc-btn-ghost cc-btn-danger"
                disabled={busy}
                onClick={handleDelete}
              >
                {t('builder.delete')}
              </button>
            )}
            <span className="cc-dialog-footer-spacer" />
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              disabled={busy}
              onClick={requestClose}
            >
              {t('builder.cancel')}
            </button>
            <button type="submit" className="cc-btn" disabled={busy}>
              {mode === 'create' ? t('builder.create') : t('builder.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function runGlyph(status: AutomationRunStatus): string {
  switch (status) {
    case 'sent':
      return '✓';
    case 'failed':
      return '!';
    case 'skipped':
      return '–';
    case 'pending':
      return '…';
  }
}

function runStatusLabel(status: AutomationRunStatus): string {
  switch (status) {
    case 'sent':
      return t('runStatus.sent');
    case 'failed':
      return t('runStatus.failed');
    case 'skipped':
      return t('runStatus.skipped');
    case 'pending':
      return t('runStatus.pending');
  }
}

function ActivityPanel({ automationId }: { automationId: string }): ReactElement {
  const runsQuery = useQuery({
    queryKey: ['automations', automationId, 'runs'],
    queryFn: () => fetchAutomationRuns(automationId),
  });

  if (runsQuery.isPending) {
    return <p role="status">{t('builder.activity.loading')}</p>;
  }
  if (runsQuery.isError) {
    return (
      <p role="alert" className="cc-rem-error">
        {t('builder.activity.failed')}
      </p>
    );
  }
  if (runsQuery.data.items.length === 0) {
    return <p className="cc-widget-placeholder">{t('builder.activity.empty')}</p>;
  }

  return (
    <ul className="cc-rem-activity">
      {runsQuery.data.items.map((run) => (
        <li key={run.id} className={`cc-rem-activity-row cc-rem-activity-${run.status}`}>
          <span aria-hidden="true">{runGlyph(run.status)}</span>{' '}
          <span className="cc-rem-activity-status">{runStatusLabel(run.status)}</span>{' '}
          <time dateTime={run.slot}>{new Date(run.slot).toLocaleString()}</time>
          {run.status === 'sent' && run.firedAt && (
            <span className="cc-rem-activity-fired"> · {formatInstantTime(run.firedAt)}</span>
          )}
          {run.error && <span className="cc-rem-activity-error"> · {run.error}</span>}
        </li>
      ))}
    </ul>
  );
}

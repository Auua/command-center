'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import type {
  CalendarEvent,
  CalendarEventWrite,
  CalendarOccurrence,
} from '@command-center/contracts';
import { Button, ErrorText, Hint } from '@command-center/ui';
import { createCalendarEvent, fetchCalendarEvent, updateCalendarEvent } from '@/lib/calendar-api';
import { addDays, instantOf, wallClockOf, weekdayNames } from '@/lib/calendar-dates';
import {
  describeRepeat,
  formFromRrule,
  NO_REPEAT,
  REPEAT_FREQUENCIES,
  rruleFromForm,
  type RepeatForm,
  type RepeatFrequency,
} from '@/lib/calendar-recurrence';
import { t } from '@/lib/i18n';
import type { DeleteScope } from './use-calendar-delete';

export type EventDialogTarget =
  | { mode: 'create'; date: string; time?: string; title?: string }
  | { mode: 'edit'; occurrence: CalendarOccurrence };

interface FormState {
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: RepeatForm | 'custom';
  location: string;
  note: string;
}

const HOUR = 60;
const toMinutes = (time: string): number => {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (total: number): string =>
  `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** Start + `minutes`, carried into the next days. */
function plusMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const total = toMinutes(time) + minutes;
  return {
    date: addDays(date, Math.floor(total / (24 * 60))),
    time: fromMinutes(((total % 1440) + 1440) % 1440),
  };
}

function minutesBetween(a: FormState): number {
  const days =
    (Date.parse(`${a.endDate}T00:00:00Z`) - Date.parse(`${a.startDate}T00:00:00Z`)) / 86_400_000;
  return days * 1440 + toMinutes(a.endTime) - toMinutes(a.startTime);
}

function createState(target: Extract<EventDialogTarget, { mode: 'create' }>): FormState {
  const startTime = target.time ?? '09:00';
  const end = plusMinutes(target.date, startTime, HOUR);
  return {
    title: target.title ?? '',
    allDay: false,
    startDate: target.date,
    startTime,
    endDate: end.date,
    endTime: end.time,
    repeat: NO_REPEAT,
    location: '',
    note: '',
  };
}

function editState(event: CalendarEvent, zone: string): FormState {
  const common = {
    title: event.title,
    repeat: formFromRrule(event.rrule),
    location: event.location ?? '',
    note: event.note ?? '',
  };
  if (event.allDay) {
    return {
      ...common,
      allDay: true,
      startDate: event.startsOn,
      startTime: '09:00',
      endDate: event.endsOn,
      endTime: '10:00',
    };
  }
  const start = wallClockOf(event.startsAt, zone);
  const end = wallClockOf(event.endsAt, zone);
  return {
    ...common,
    allDay: false,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

function problemOf(form: FormState): string | null {
  if (!form.title.trim()) return t('calendar.invalid.title');
  if (form.allDay ? form.endDate < form.startDate : minutesBetween(form) <= 0) {
    return t('calendar.invalid.end');
  }
  if (form.repeat !== 'custom' && form.repeat.frequency !== 'none') {
    if (form.repeat.end.kind === 'until' && form.repeat.end.date < form.startDate) {
      return t('calendar.invalid.until');
    }
    if (
      form.repeat.end.kind === 'count' &&
      !(
        Number.isInteger(form.repeat.end.count) &&
        form.repeat.end.count >= 1 &&
        form.repeat.end.count <= 999
      )
    ) {
      return t('calendar.invalid.count');
    }
  }
  return null;
}

function toWrite(form: FormState, zone: string, storedRule: string | null): CalendarEventWrite {
  const rrule = form.repeat === 'custom' ? storedRule : rruleFromForm(form.repeat, form.startDate);
  const common = {
    title: form.title.trim(),
    location: form.location.trim() || null,
    note: form.note.trim() || null,
    rrule,
  };
  return form.allDay
    ? { ...common, allDay: true, startsOn: form.startDate, endsOn: form.endDate }
    : {
        ...common,
        allDay: false,
        startsAt: instantOf(form.startDate, form.startTime, zone),
        endsAt: instantOf(form.endDate, form.endTime, zone),
      };
}

/**
 * Create / edit an event (ADR-018): a native modal `<dialog>` — focus trap,
 * Esc and the top layer come free; Esc and Cancel confirm first when the
 * form is dirty. Times are edited in the home timezone. Editing a recurring
 * event edits the whole series; deleting one asks "only this one / the
 * whole series". Saves wait for the server (a new series can only be shown
 * once the server has expanded it); deleting hands over to the undo flow.
 */
export function EventDialog({
  target,
  zone,
  weekStartsOn,
  onClose,
  onDelete,
}: {
  target: EventDialogTarget;
  zone: string;
  weekStartsOn: number;
  onClose: () => void;
  onDelete: (occurrence: CalendarOccurrence, scope: DeleteScope) => void;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dirty = useRef(false);

  const seriesId = target.mode === 'edit' ? target.occurrence.seriesId : null;
  const event = useQuery({
    queryKey: ['calendar-event', seriesId],
    queryFn: () => fetchCalendarEvent(seriesId ?? ''),
    enabled: seriesId !== null,
    staleTime: 0,
  });

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
  }, []);

  const requestClose = (): void => {
    if (dirty.current && !window.confirm(t('calendar.discardConfirm'))) return;
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="cc-dialog cc-calendar-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
    >
      <h2 id={titleId} className="cc-dialog-title">
        {t(target.mode === 'create' ? 'calendar.dialog.new' : 'calendar.dialog.edit')}
      </h2>
      {target.mode === 'create' ? (
        <EventForm
          initial={createState(target)}
          zone={zone}
          weekStartsOn={weekStartsOn}
          storedRule={null}
          dirty={dirty}
          onCancel={requestClose}
          onDone={onClose}
        />
      ) : event.isPending ? (
        <p className="cc-hint">{t('calendar.loading')}</p>
      ) : event.isError || !event.data ? (
        <>
          <ErrorText>{t('calendar.loadEventFailed')}</ErrorText>
          <div className="cc-dialog-footer">
            <span className="cc-dialog-footer-spacer" />
            <Button variant="ghost" onClick={onClose}>
              {t('calendar.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <EventForm
          key={event.data.updatedAt}
          initial={editState(event.data, zone)}
          zone={zone}
          weekStartsOn={weekStartsOn}
          storedRule={event.data.rrule}
          seriesId={event.data.id}
          occurrence={target.occurrence}
          dirty={dirty}
          onCancel={requestClose}
          onDone={onClose}
          onDelete={(scope) => {
            onDelete(target.occurrence, scope);
            onClose();
          }}
        />
      )}
    </dialog>
  );
}

function EventForm({
  initial,
  zone,
  weekStartsOn,
  storedRule,
  seriesId,
  occurrence,
  dirty,
  onCancel,
  onDone,
  onDelete,
}: {
  initial: FormState;
  zone: string;
  weekStartsOn: number;
  storedRule: string | null;
  seriesId?: string;
  occurrence?: CalendarOccurrence;
  dirty: { current: boolean };
  onCancel: () => void;
  onDone: () => void;
  onDelete?: (scope: DeleteScope) => void;
}): ReactElement {
  const id = useId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [choosingDelete, setChoosingDelete] = useState(false);
  const names = useMemo(() => weekdayNames(weekStartsOn), [weekStartsOn]);

  dirty.current = JSON.stringify(form) !== JSON.stringify(initial);

  const set = (patch: Partial<FormState>): void => setForm((current) => ({ ...current, ...patch }));

  /** Moving the start keeps the duration, as calendars do. */
  const moveStart = (patch: Partial<Pick<FormState, 'startDate' | 'startTime'>>): void =>
    setForm((current) => {
      const next = { ...current, ...patch };
      if (current.allDay) {
        const span = Math.max(
          0,
          (Date.parse(`${current.endDate}T00:00:00Z`) -
            Date.parse(`${current.startDate}T00:00:00Z`)) /
            86_400_000,
        );
        return { ...next, endDate: addDays(next.startDate, span) };
      }
      const end = plusMinutes(next.startDate, next.startTime, Math.max(minutesBetween(current), 0));
      return { ...next, endDate: end.date, endTime: end.time };
    });

  const repeat = form.repeat;
  const setRepeat = (patch: Partial<RepeatForm>): void =>
    set({ repeat: { ...(repeat === 'custom' ? NO_REPEAT : repeat), ...patch } });

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const found = problemOf(form);
    setProblem(found);
    if (found) return;
    setSaving(true);
    try {
      const body = toWrite(form, zone, storedRule);
      if (seriesId) await updateCalendarEvent(seriesId, body);
      else await createCalendarEvent(body);
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
      dirty.current = false;
      onDone();
    } catch {
      setProblem(t('calendar.saveFailed.generic'));
      setSaving(false);
    }
  };

  if (choosingDelete && onDelete) {
    return (
      <div className="cc-dialog-body">
        <p>{t('calendar.delete.title', { title: initial.title })}</p>
        <p className="cc-hint">{t('calendar.delete.which')}</p>
        <div className="cc-dialog-footer cc-calendar-delete-choice">
          <Button variant="danger" onClick={() => onDelete('occurrence')}>
            {t('calendar.delete.occurrence')}
          </Button>
          <Button variant="danger" onClick={() => onDelete('series')}>
            {t('calendar.delete.series')}
          </Button>
          <span className="cc-dialog-footer-spacer" />
          <Button variant="ghost" onClick={() => setChoosingDelete(false)}>
            {t('calendar.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  const frequency: RepeatFrequency | 'custom' = repeat === 'custom' ? 'custom' : repeat.frequency;

  return (
    <form className="cc-dialog-body cc-calendar-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="cc-field">
        <label className="cc-field-label" htmlFor={`${id}-title`}>
          {t('calendar.field.title')}
        </label>
        <input
          id={`${id}-title`}
          type="text"
          autoFocus
          required
          maxLength={200}
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>

      <label className="cc-field cc-field-check" htmlFor={`${id}-allday`}>
        <input
          id={`${id}-allday`}
          type="checkbox"
          checked={form.allDay}
          onChange={(e) => set({ allDay: e.target.checked })}
        />
        <span className="cc-field-label">{t('calendar.field.allDay')}</span>
      </label>

      <div className="cc-calendar-when">
        <div className="cc-field">
          <label className="cc-field-label" htmlFor={`${id}-sd`}>
            {t('calendar.field.startDate')}
          </label>
          <input
            id={`${id}-sd`}
            type="date"
            required
            value={form.startDate}
            onChange={(e) => e.target.value && moveStart({ startDate: e.target.value })}
          />
        </div>
        {!form.allDay && (
          <div className="cc-field">
            <label className="cc-field-label" htmlFor={`${id}-st`}>
              {t('calendar.field.startTime')}
            </label>
            <input
              id={`${id}-st`}
              type="time"
              required
              value={form.startTime}
              onChange={(e) => e.target.value && moveStart({ startTime: e.target.value })}
            />
          </div>
        )}
        <div className="cc-field">
          <label className="cc-field-label" htmlFor={`${id}-ed`}>
            {t('calendar.field.endDate')}
          </label>
          <input
            id={`${id}-ed`}
            type="date"
            required
            value={form.endDate}
            onChange={(e) => e.target.value && set({ endDate: e.target.value })}
          />
        </div>
        {!form.allDay && (
          <div className="cc-field">
            <label className="cc-field-label" htmlFor={`${id}-et`}>
              {t('calendar.field.endTime')}
            </label>
            <input
              id={`${id}-et`}
              type="time"
              required
              value={form.endTime}
              onChange={(e) => e.target.value && set({ endTime: e.target.value })}
            />
          </div>
        )}
      </div>
      {!form.allDay && zone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
        <Hint>{t('calendar.zoneNote', { zone })}</Hint>
      )}

      <div className="cc-field">
        <label className="cc-field-label" htmlFor={`${id}-repeat`}>
          {t('calendar.field.repeat')}
        </label>
        <select
          id={`${id}-repeat`}
          value={frequency}
          onChange={(e) =>
            e.target.value === 'custom'
              ? set({ repeat: 'custom' })
              : setRepeat({ frequency: e.target.value as RepeatFrequency })
          }
        >
          {REPEAT_FREQUENCIES.map((option) => (
            <option key={option} value={option}>
              {option === 'none' ? t('calendar.repeat.none') : t(`calendar.repeat.every.${option}`)}
            </option>
          ))}
          {repeat === 'custom' && <option value="custom">{t('calendar.repeat.custom')}</option>}
        </select>
      </div>

      {repeat !== 'custom' && repeat.frequency !== 'none' && (
        <fieldset className="cc-calendar-repeat">
          <legend className="cc-visually-hidden">{t('calendar.field.repeat')}</legend>
          <div className="cc-calendar-repeat-row">
            <label className="cc-field-label" htmlFor={`${id}-interval`}>
              {t('calendar.field.interval')}
            </label>
            <input
              id={`${id}-interval`}
              type="number"
              min={1}
              max={99}
              value={repeat.interval}
              onChange={(e) =>
                setRepeat({ interval: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })
              }
            />
            <span>{t(`calendar.unit.${repeat.frequency}`)}</span>
          </div>

          {repeat.frequency === 'weekly' && (
            <fieldset className="cc-calendar-weekdays">
              <legend className="cc-field-label">{t('calendar.field.weekdays')}</legend>
              {names.map((name, index) => {
                const day = (weekStartsOn + index) % 7;
                const fallback = new Date(`${form.startDate}T00:00:00Z`).getUTCDay();
                const checked =
                  repeat.weekdays.length > 0 ? repeat.weekdays.includes(day) : day === fallback;
                return (
                  <label key={day} className="cc-calendar-weekday" title={name.long}>
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={name.long}
                      onChange={(e) => {
                        const base = repeat.weekdays.length > 0 ? repeat.weekdays : [fallback];
                        const next = e.target.checked
                          ? [...base, day]
                          : base.filter((d) => d !== day);
                        setRepeat({ weekdays: next });
                      }}
                    />
                    <span aria-hidden="true">{name.short}</span>
                  </label>
                );
              })}
            </fieldset>
          )}

          <fieldset className="cc-calendar-ends">
            <legend className="cc-field-label">{t('calendar.field.ends')}</legend>
            <label className="cc-field-check">
              <input
                type="radio"
                name={`${id}-ends`}
                checked={repeat.end.kind === 'never'}
                onChange={() => setRepeat({ end: { kind: 'never' } })}
              />
              {t('calendar.ends.never')}
            </label>
            <label className="cc-field-check">
              <input
                type="radio"
                name={`${id}-ends`}
                checked={repeat.end.kind === 'until'}
                onChange={() =>
                  setRepeat({ end: { kind: 'until', date: addDays(form.startDate, 30) } })
                }
              />
              {t('calendar.ends.until')}
            </label>
            {repeat.end.kind === 'until' && (
              <input
                type="date"
                aria-label={t('calendar.ends.untilDate')}
                value={repeat.end.date}
                onChange={(e) =>
                  e.target.value && setRepeat({ end: { kind: 'until', date: e.target.value } })
                }
              />
            )}
            <label className="cc-field-check">
              <input
                type="radio"
                name={`${id}-ends`}
                checked={repeat.end.kind === 'count'}
                onChange={() => setRepeat({ end: { kind: 'count', count: 10 } })}
              />
              {t('calendar.ends.count')}
            </label>
            {repeat.end.kind === 'count' && (
              <input
                type="number"
                min={1}
                max={999}
                aria-label={t('calendar.ends.countLabel')}
                value={repeat.end.count}
                onChange={(e) =>
                  setRepeat({ end: { kind: 'count', count: Number(e.target.value) } })
                }
              />
            )}
          </fieldset>
          <Hint>
            {describeRepeat(
              repeat.frequency === 'weekly' && repeat.weekdays.length === 0
                ? { ...repeat, weekdays: [new Date(`${form.startDate}T00:00:00Z`).getUTCDay()] }
                : repeat,
            )}
          </Hint>
        </fieldset>
      )}
      {occurrence?.isRecurring && <Hint>{t('calendar.seriesEditHint')}</Hint>}

      <div className="cc-field">
        <label className="cc-field-label" htmlFor={`${id}-location`}>
          {t('calendar.field.location')}
        </label>
        <input
          id={`${id}-location`}
          type="text"
          maxLength={200}
          value={form.location}
          onChange={(e) => set({ location: e.target.value })}
        />
      </div>
      <div className="cc-field">
        <label className="cc-field-label" htmlFor={`${id}-note`}>
          {t('calendar.field.note')}
        </label>
        <textarea
          id={`${id}-note`}
          rows={3}
          maxLength={2000}
          value={form.note}
          onChange={(e) => set({ note: e.target.value })}
        />
      </div>

      {problem && <ErrorText>{problem}</ErrorText>}

      <div className="cc-dialog-footer">
        {onDelete && occurrence && (
          <Button
            variant="danger"
            onClick={() => (occurrence.isRecurring ? setChoosingDelete(true) : onDelete('series'))}
          >
            {t('calendar.delete')}
          </Button>
        )}
        <span className="cc-dialog-footer-spacer" />
        <Button variant="ghost" onClick={onCancel}>
          {t('calendar.cancel')}
        </Button>
        <Button type="submit" busy={saving}>
          {t(seriesId ? 'calendar.save' : 'calendar.create')}
        </Button>
      </div>
    </form>
  );
}

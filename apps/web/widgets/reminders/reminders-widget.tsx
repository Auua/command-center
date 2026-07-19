'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { z } from 'zod';
import type { AutomationTemplate, TodayResponse } from '@command-center/contracts';
import { useQuickAction } from '@command-center/ui';
import { createAutomation, fetchToday, updateAutomation } from '@/lib/automations-api';
import { t } from '@/lib/i18n';
import type { WidgetProps } from '@command-center/ui';
import { BuilderModal } from './builder-modal';
import { PermissionBanner } from './permission-banner';
import { SlotRow } from './slot-row';
import { TemplatesEmptyState } from './templates-empty-state';
import type { HourCycleSetting } from './time-format';
import { usePushPermission } from './use-push-permission';

export const remindersSettingsSchema = z.object({
  maxRows: z.number().int().min(1).max(20).default(6),
  showEventAutomations: z.boolean().default(true),
  hourCycle: z.enum(['h12', 'h23', 'auto']).default('auto'),
});

export type RemindersSettings = z.input<typeof remindersSettingsSchema>;

const TODAY_KEY = ['automations', 'today'];

type ModalState = { mode: 'create' } | { mode: 'edit'; automationId: string } | null;

interface Announcements {
  polite: string;
  alert: string;
}

/**
 * Today's reminders (ADR-015): server-expanded timed slots + event
 * automations below a divider. The client never evaluates schedules — it
 * renders what GET /automations/today returns. Toggling is optimistic with
 * rollback; announcements follow the house pattern (successes polite,
 * failures role="alert").
 */
export function RemindersWidget({ settings }: WidgetProps<RemindersSettings>): ReactElement {
  const { maxRows = 6, showEventAutomations = true, hourCycle = 'auto' } = settings;
  const queryClient = useQueryClient();

  const todayQuery = useQuery({ queryKey: TODAY_KEY, queryFn: fetchToday });

  const [announcements, setAnnouncements] = useState<Announcements>({ polite: '', alert: '' });
  const announce = useCallback((kind: 'polite' | 'alert', message: string): void => {
    setAnnouncements((current) =>
      kind === 'polite' ? { polite: message, alert: '' } : { ...current, alert: message },
    );
  }, []);

  const [modal, setModal] = useState<ModalState>(null);
  const invokerRef = useRef<HTMLElement | null>(null);

  const openModal = useCallback((state: Exclude<ModalState, null>): void => {
    invokerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setModal(state);
  }, []);

  const closeModal = useCallback((): void => {
    setModal(null);
    // ADR-015: focus returns to the invoking control.
    invokerRef.current?.focus();
    invokerRef.current = null;
  }, []);

  useQuickAction('add-automation', () => openModal({ mode: 'create' }));

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean; name: string }) =>
      updateAutomation(id, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: TODAY_KEY });
      const previous = queryClient.getQueryData<TodayResponse>(TODAY_KEY);
      // The toggle pauses the whole automation: flip every row it owns.
      queryClient.setQueryData<TodayResponse>(TODAY_KEY, (current) =>
        current
          ? {
              slots: current.slots.map((slot) =>
                slot.automationId === id ? { ...slot, enabled } : slot,
              ),
              events: current.events.map((event) =>
                event.automationId === id ? { ...event, enabled } : event,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, { enabled, name }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(TODAY_KEY, context.previous);
      }
      announce(
        'alert',
        enabled
          ? t('reminders.toggle.failed.resume', { name })
          : t('reminders.toggle.failed.pause', { name }),
      );
    },
    onSuccess: (_data, { enabled, name }) => {
      announce(
        'polite',
        enabled ? t('reminders.toggle.resumed', { name }) : t('reminders.toggle.paused', { name }),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TODAY_KEY }),
  });

  // One-tap template: create enabled, then open pre-filled in the editor.
  const templateMutation = useMutation({
    mutationFn: (template: AutomationTemplate) =>
      createAutomation({
        name: template.name,
        kind: template.kind,
        schedule: template.schedule,
        action: template.action,
        enabled: true,
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['automations'] });
      openModal({ mode: 'edit', automationId: created.id });
    },
    onError: () => announce('alert', t('builder.error.save')),
  });

  const handleToggle = (automationId: string, enabled: boolean, name: string): void => {
    toggleMutation.mutate({ id: automationId, enabled, name });
  };
  const handleEdit = (automationId: string): void => openModal({ mode: 'edit', automationId });

  const data = todayQuery.data;
  const hasEnabledTimed = data?.slots.some((slot) => slot.enabled) ?? false;
  const pushPermission = usePushPermission(hasEnabledTimed);
  const pendingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  const sortedSlots = data
    ? [...data.slots].sort((a, b) => a.at.localeCompare(b.at)).slice(0, maxRows)
    : [];
  const events = data && showEventAutomations ? data.events : [];
  const isEmpty = data !== undefined && data.slots.length === 0 && data.events.length === 0;

  return (
    <div className="cc-rem">
      {/* House pattern: persistent live regions — successes polite, failures alert. */}
      <p className="cc-visually-hidden" role="status" aria-live="polite">
        {announcements.polite}
      </p>
      <p className="cc-visually-hidden" role="alert">
        {announcements.alert}
      </p>

      <PermissionBanner
        ux={pushPermission.ux}
        onEnable={pushPermission.enable}
        onDismiss={pushPermission.dismiss}
        announce={announce}
      />

      {todayQuery.isPending ? (
        <>
          <p className="cc-visually-hidden" role="status">
            {t('reminders.loading')}
          </p>
          <ul className="cc-rem-list" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="cc-rem-ghost">
                <span className="cc-rem-ghost-time" />
                <span className="cc-rem-ghost-name" />
                <span className="cc-rem-ghost-switch" />
              </li>
            ))}
          </ul>
        </>
      ) : todayQuery.isError ? (
        <div className="cc-rem-error-state">
          <p role="alert" className="cc-rem-error">
            {t('reminders.loadFailed')}
          </p>
          <button
            type="button"
            className="cc-btn cc-btn-ghost"
            onClick={() => void todayQuery.refetch()}
          >
            {t('reminders.retry')}
          </button>
        </div>
      ) : isEmpty ? (
        <TemplatesEmptyState
          hourCycle={hourCycle as HourCycleSetting}
          creating={templateMutation.isPending}
          onCreateFromTemplate={(template) => templateMutation.mutate(template)}
        />
      ) : (
        <>
          {sortedSlots.length > 0 && (
            <ul className="cc-rem-list">
              {sortedSlots.map((slot) => (
                <SlotRow
                  key={`${slot.automationId}:${slot.at}`}
                  automationId={slot.automationId}
                  name={slot.name}
                  enabled={slot.enabled}
                  at={slot.at}
                  run={slot.run}
                  hourCycle={hourCycle as HourCycleSetting}
                  pending={pendingId === slot.automationId}
                  onToggle={handleToggle}
                  onEdit={handleEdit}
                />
              ))}
            </ul>
          )}
          {events.length > 0 && (
            <>
              <h3 className="cc-rem-divider">{t('reminders.eventsHeading')}</h3>
              <ul className="cc-rem-list">
                {events.map((event) => (
                  <SlotRow
                    key={event.automationId}
                    automationId={event.automationId}
                    name={event.name}
                    enabled={event.enabled}
                    run={event.lastRun}
                    hourCycle={hourCycle as HourCycleSetting}
                    pending={pendingId === event.automationId}
                    onToggle={handleToggle}
                    onEdit={handleEdit}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {modal && (
        <BuilderModal
          mode={modal.mode}
          automationId={modal.mode === 'edit' ? modal.automationId : undefined}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

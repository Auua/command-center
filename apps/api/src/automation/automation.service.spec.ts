import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Automation } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ProfileService } from '../profile/profile.service';
import type {
  AutomationInsert,
  AutomationPatch,
  AutomationRepository,
  RunSlotRow,
} from './automation.repository';
import { AutomationService } from './automation.service';
import { AUTOMATION_TEMPLATES } from './templates';

const ANNA: AuthenticatedUser = { id: 'user-1', token: 'jwt' };

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: '9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f',
    name: 'Hydration break',
    kind: 'recurring',
    schedule: { type: 'daily', time: '12:00' },
    eventKey: null,
    action: { type: 'notify', title: 'Hydration break', body: null },
    enabled: true,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

class FakeAutomationRepository {
  items: Automation[] = [];
  inserts: AutomationInsert[] = [];
  patches: { id: string; patch: AutomationPatch }[] = [];
  windowRuns: RunSlotRow[] = [];
  latestRuns: RunSlotRow[] = [];

  listForUser(): Promise<Automation[]> {
    return Promise.resolve(this.items);
  }

  getForUser(_user: AuthenticatedUser, id: string): Promise<Automation | null> {
    return Promise.resolve(this.items.find((item) => item.id === id) ?? null);
  }

  createForUser(_user: AuthenticatedUser, values: AutomationInsert): Promise<Automation> {
    this.inserts.push(values);
    return Promise.resolve(
      automation({
        name: values.name,
        kind: values.kind,
        schedule: values.schedule,
        eventKey: values.event_key,
        action: values.action,
        enabled: values.enabled,
      }),
    );
  }

  updateForUser(
    _user: AuthenticatedUser,
    id: string,
    patch: AutomationPatch,
  ): Promise<Automation | null> {
    const existing = this.items.find((item) => item.id === id);
    if (!existing) {
      return Promise.resolve(null);
    }
    this.patches.push({ id, patch });
    return Promise.resolve(existing);
  }

  deleteForUser(_user: AuthenticatedUser, id: string): Promise<boolean> {
    return Promise.resolve(this.items.some((item) => item.id === id));
  }

  listRunsForAutomation(): Promise<never[]> {
    return Promise.resolve([]);
  }

  listRunsInWindow(): Promise<RunSlotRow[]> {
    return Promise.resolve(this.windowRuns);
  }

  listLatestRuns(): Promise<RunSlotRow[]> {
    return Promise.resolve(this.latestRuns);
  }
}

class FakeProfileService {
  timezone = 'Europe/Helsinki';

  getTimezone(): Promise<string> {
    return Promise.resolve(this.timezone);
  }
}

describe('AutomationService', () => {
  let repository: FakeAutomationRepository;
  let profileService: FakeProfileService;
  let service: AutomationService;

  beforeEach(() => {
    repository = new FakeAutomationRepository();
    profileService = new FakeProfileService();
    service = new AutomationService(
      repository as unknown as AutomationRepository,
      profileService as unknown as ProfileService,
    );
    // A fixed summer instant: 2026-07-19 (Sunday) 10:30 Helsinki (EEST).
    service.now = () => new Date('2026-07-19T07:30:00.000Z');
  });

  describe('create/update — the single cron_expr write path', () => {
    it('compiles schedule → cron_expr on recurring create', async () => {
      await service.createAutomation(ANNA, {
        name: 'Hydration break',
        kind: 'recurring',
        schedule: { type: 'daily', time: '12:00' },
        action: { type: 'notify', title: 'Hydration break', body: null },
        enabled: true,
      });

      expect(repository.inserts[0]).toMatchObject({
        kind: 'recurring',
        cron_expr: '0 12 * * *',
        event_key: null,
      });
    });

    it('stores event automations with event_key and no cron', async () => {
      await service.createAutomation(ANNA, {
        name: 'After a task',
        kind: 'event',
        eventKey: 'task.completed',
        action: { type: 'notify', title: 'Nice work', body: null },
        enabled: true,
      });

      expect(repository.inserts[0]).toMatchObject({
        kind: 'event',
        schedule: null,
        cron_expr: null,
        event_key: 'task.completed',
      });
    });

    it('recompiles cron_expr when a schedule update arrives', async () => {
      repository.items = [automation()];

      await service.updateAutomation(ANNA, repository.items[0]!.id, {
        schedule: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] },
      });

      expect(repository.patches[0]!.patch).toEqual({
        schedule: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] },
        cron_expr: '30 8 * * 1,2,3,4,5',
      });
    });

    it('passes the toggle path through without touching cron', async () => {
      repository.items = [automation()];

      await service.updateAutomation(ANNA, repository.items[0]!.id, { enabled: false });

      expect(repository.patches[0]!.patch).toEqual({ enabled: false });
    });

    it('400s a schedule on an event automation (kind is immutable)', async () => {
      repository.items = [
        automation({ kind: 'event', schedule: null, eventKey: 'task.completed' }),
      ];

      await expect(
        service.updateAutomation(ANNA, repository.items[0]!.id, {
          schedule: { type: 'daily', time: '09:00' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s an eventKey on a recurring automation', async () => {
      repository.items = [automation()];

      await expect(
        service.updateAutomation(ANNA, repository.items[0]!.id, { eventKey: 'task.completed' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('404-not-403', () => {
    it.each(['update', 'delete', 'runs'] as const)(
      '%s of a missing/foreign id 404s',
      async (operation) => {
        const missing = '00000000-0000-0000-0000-000000000000';
        const call =
          operation === 'update'
            ? service.updateAutomation(ANNA, missing, { enabled: false })
            : operation === 'delete'
              ? service.deleteAutomation(ANNA, missing)
              : service.listRuns(ANNA, missing, 20);
        await expect(call).rejects.toBeInstanceOf(NotFoundException);
      },
    );
  });

  describe('templates', () => {
    it('serves the static template list', () => {
      expect(service.getTemplates()).toEqual({ items: AUTOMATION_TEMPLATES });
    });
  });

  describe('getToday', () => {
    it('expands every recurring automation over the local day with offset ISO times', async () => {
      repository.items = [
        automation(),
        automation({
          id: '2b1c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8',
          name: 'Morning stretch',
          schedule: { type: 'daily', time: '08:00' },
          enabled: false,
        }),
      ];

      const today = await service.getToday(ANNA);

      // Sorted by time: 08:00 before 12:00; disabled automations included.
      expect(today.slots.map((slot) => slot.at)).toEqual([
        '2026-07-19T08:00:00.000+03:00',
        '2026-07-19T12:00:00.000+03:00',
      ]);
      expect(today.slots[0]).toMatchObject({ name: 'Morning stretch', enabled: false });
      expect(today.events).toEqual([]);
    });

    it('joins run outcomes by UTC slot and never surfaces pending', async () => {
      repository.items = [automation()];
      // 12:00 Helsinki = 09:00 UTC.
      repository.windowRuns = [
        {
          automationId: repository.items[0]!.id,
          slot: '2026-07-19T09:00:00.000Z',
          status: 'sent',
          firedAt: '2026-07-19T09:00:04.000Z',
        },
      ];

      const today = await service.getToday(ANNA);
      expect(today.slots[0]!.run).toEqual({
        status: 'sent',
        firedAt: '2026-07-19T09:00:04.000Z',
      });

      repository.windowRuns[0]!.status = 'pending';
      const withPending = await service.getToday(ANNA);
      expect(withPending.slots[0]!.run).toBeUndefined();
    });

    it('lists event automations with their latest run', async () => {
      const eventAutomation = automation({
        id: '2b1c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8',
        name: 'After a task',
        kind: 'event',
        schedule: null,
        eventKey: 'task.completed',
      });
      repository.items = [eventAutomation];
      repository.latestRuns = [
        {
          automationId: eventAutomation.id,
          slot: '2026-07-18T14:00:00.000Z',
          status: 'sent',
          firedAt: '2026-07-18T14:00:02.000Z',
        },
      ];

      const today = await service.getToday(ANNA);

      expect(today.slots).toEqual([]);
      expect(today.events).toEqual([
        {
          automationId: eventAutomation.id,
          name: 'After a task',
          eventKey: 'task.completed',
          enabled: true,
          lastRun: { status: 'sent', firedAt: '2026-07-18T14:00:02.000Z' },
        },
      ]);
    });

    it('expands interval schedules across the whole local day', async () => {
      repository.items = [automation({ schedule: { type: 'interval', everyMinutes: 720 } })];

      const today = await service.getToday(ANNA);

      // 00:00 and 12:00 local (EEST = UTC+3).
      expect(today.slots.map((slot) => slot.at)).toEqual([
        '2026-07-19T00:00:00.000+03:00',
        '2026-07-19T12:00:00.000+03:00',
      ]);
    });
  });
});

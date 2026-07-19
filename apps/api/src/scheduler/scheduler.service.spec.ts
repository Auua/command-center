import 'reflect-metadata';
import type { DispatchService } from './dispatch.service';
import type {
  PendingRun,
  RecurringAutomation,
  SchedulerRepository,
  SchedulerState,
} from './scheduler.repository';
import { SCHEDULER_NAME, SchedulerService } from './scheduler.service';

const NOW = new Date('2026-07-19T12:00:30.000Z');

const HOURLY: RecurringAutomation = {
  id: 'auto-hourly',
  userId: 'user-1',
  cronExpr: '0 * * * *', // every hour on the hour
  timezone: 'Europe/Helsinki',
};

class FakeSchedulerRepository {
  state: SchedulerState | null = null;
  automations: RecurringAutomation[] = [];
  stalePending: PendingRun[] = [];
  alreadyClaimed = new Set<string>(); // `${automationId}|${slotIso}`

  claims: { automationId: string; slot: string }[] = [];
  skipped: { automationId: string; slot: string }[] = [];
  upserts: { name: string; cursorAt: Date; lastTickAt: Date }[] = [];
  staleQueries: Date[] = [];
  private nextRunId = 0;

  getState(): Promise<SchedulerState | null> {
    return Promise.resolve(this.state);
  }

  upsertState(name: string, cursorAt: Date, lastTickAt: Date): Promise<void> {
    this.upserts.push({ name, cursorAt, lastTickAt });
    return Promise.resolve();
  }

  listEnabledRecurringAutomations(): Promise<RecurringAutomation[]> {
    return Promise.resolve(this.automations);
  }

  listStalePendingRuns(olderThan: Date): Promise<PendingRun[]> {
    this.staleQueries.push(olderThan);
    return Promise.resolve(this.stalePending);
  }

  claimRun(automationId: string, _userId: string, slot: Date): Promise<string | null> {
    const key = `${automationId}|${slot.toISOString()}`;
    if (this.alreadyClaimed.has(key)) {
      return Promise.resolve(null);
    }
    this.claims.push({ automationId, slot: slot.toISOString() });
    this.nextRunId += 1;
    return Promise.resolve(`run-${this.nextRunId}`);
  }

  insertSkippedRun(automationId: string, _userId: string, slot: Date): Promise<void> {
    this.skipped.push({ automationId, slot: slot.toISOString() });
    return Promise.resolve();
  }
}

class FakeDispatchService {
  dispatched: PendingRun[] = [];
  failFor = new Set<string>();

  dispatchRun(run: PendingRun): Promise<void> {
    if (this.failFor.has(run.runId)) {
      return Promise.reject(new Error('dispatch boom'));
    }
    this.dispatched.push(run);
    return Promise.resolve();
  }
}

describe('SchedulerService.tick', () => {
  let repository: FakeSchedulerRepository;
  let dispatch: FakeDispatchService;
  let service: SchedulerService;

  beforeEach(() => {
    repository = new FakeSchedulerRepository();
    dispatch = new FakeDispatchService();
    service = new SchedulerService(
      repository as unknown as SchedulerRepository,
      dispatch as unknown as DispatchService,
    );
    service.now = () => NOW;
  });

  it('initializes the cursor to now − 1 min on the very first run', async () => {
    repository.automations = [HOURLY];

    await service.tick();

    // Window (11:59:30, 12:00:30] contains the 12:00:00 slot.
    expect(repository.claims).toEqual([
      { automationId: 'auto-hourly', slot: '2026-07-19T12:00:00.000Z' },
    ]);
    expect(dispatch.dispatched).toHaveLength(1);
  });

  it('advances cursor_at and last_tick_at to now, every tick', async () => {
    await service.tick();

    expect(repository.upserts).toEqual([{ name: SCHEDULER_NAME, cursorAt: NOW, lastTickAt: NOW }]);
  });

  it('expands exactly the (cursor, now] window on a normal tick', async () => {
    repository.state = {
      cursorAt: new Date('2026-07-19T11:59:30.000Z'),
      lastTickAt: new Date('2026-07-19T11:59:30.000Z'),
    };
    repository.automations = [HOURLY];

    await service.tick();

    expect(repository.claims).toEqual([
      { automationId: 'auto-hourly', slot: '2026-07-19T12:00:00.000Z' },
    ]);
    expect(repository.skipped).toEqual([]);
  });

  it('fires nothing when the window holds no occurrence, but still advances', async () => {
    repository.state = {
      cursorAt: new Date('2026-07-19T12:00:10.000Z'),
      lastTickAt: new Date('2026-07-19T12:00:10.000Z'),
    };
    repository.automations = [HOURLY];

    await service.tick();

    expect(repository.claims).toEqual([]);
    expect(repository.upserts).toHaveLength(1);
  });

  it('skips slots another (overlapping) tick already claimed', async () => {
    repository.state = {
      cursorAt: new Date('2026-07-19T11:59:30.000Z'),
      lastTickAt: null,
    };
    repository.automations = [HOURLY];
    repository.alreadyClaimed.add('auto-hourly|2026-07-19T12:00:00.000Z');

    await service.tick();

    expect(dispatch.dispatched).toHaveLength(0);
    expect(repository.upserts).toHaveLength(1); // cursor still advances
  });

  it('catch-up: fires slots within the 60-min cap, records older ones skipped', async () => {
    // Pinger dead for 3 hours: cursor at 09:00:30.
    repository.state = {
      cursorAt: new Date('2026-07-19T09:00:30.000Z'),
      lastTickAt: null,
    };
    repository.automations = [HOURLY];

    await service.tick();

    // Cap start = 11:00:30 → 12:00 fires; 10:00 and 11:00 are skipped.
    expect(repository.claims).toEqual([
      { automationId: 'auto-hourly', slot: '2026-07-19T12:00:00.000Z' },
    ]);
    expect(repository.skipped).toEqual([
      { automationId: 'auto-hourly', slot: '2026-07-19T10:00:00.000Z' },
      { automationId: 'auto-hourly', slot: '2026-07-19T11:00:00.000Z' },
    ]);
  });

  it('bounds skipped-slot bookkeeping to the 24 h lookback after long downtime', async () => {
    repository.state = {
      cursorAt: new Date('2026-07-12T12:00:30.000Z'), // a week ago
      lastTickAt: null,
    };
    repository.automations = [HOURLY];

    await service.tick();

    // Only the last 24 h (minus the live hour) is recorded skipped: 23 slots.
    expect(repository.skipped).toHaveLength(23);
    expect(repository.skipped[0]!.slot).toBe('2026-07-18T13:00:00.000Z');
    expect(repository.skipped[22]!.slot).toBe('2026-07-19T11:00:00.000Z');
  });

  it('re-processes stale pending runs through the same dispatch tail', async () => {
    const stale: PendingRun = {
      runId: 'run-stale',
      automationId: 'auto-hourly',
      userId: 'user-1',
      slot: new Date('2026-07-19T11:00:00.000Z'),
    };
    repository.stalePending = [stale];

    await service.tick();

    expect(repository.staleQueries).toEqual([new Date(NOW.getTime() - 5 * 60_000)]);
    expect(dispatch.dispatched).toContainEqual(stale);
  });

  it('a dispatch failure neither aborts the tick nor blocks the cursor', async () => {
    repository.state = {
      cursorAt: new Date('2026-07-19T11:29:30.000Z'),
      lastTickAt: null,
    };
    repository.automations = [{ ...HOURLY, cronExpr: '*/30 * * * *' }];
    dispatch.failFor.add('run-1'); // the 11:30 slot dispatch will throw

    await service.tick();

    // Both slots (11:30, 12:00) were claimed; the failed one stays pending
    // for the stale sweep.
    expect(repository.claims).toHaveLength(2);
    expect(dispatch.dispatched).toHaveLength(1);
    expect(repository.upserts).toHaveLength(1);
  });

  it('a malformed stored cron skips that automation, not the tick', async () => {
    repository.state = {
      cursorAt: new Date('2026-07-19T11:59:30.000Z'),
      lastTickAt: null,
    };
    repository.automations = [{ ...HOURLY, id: 'auto-broken', cronExpr: 'not a cron' }, HOURLY];

    await service.tick();

    expect(repository.claims).toEqual([
      { automationId: 'auto-hourly', slot: '2026-07-19T12:00:00.000Z' },
    ]);
    expect(repository.upserts).toHaveLength(1);
  });

  it('evaluates each automation in its own timezone', async () => {
    // Daily 15:00 Helsinki (12:00 UTC in July) vs daily 15:00 Tokyo.
    repository.state = {
      cursorAt: new Date('2026-07-19T11:59:30.000Z'),
      lastTickAt: null,
    };
    repository.automations = [
      { id: 'helsinki', userId: 'user-1', cronExpr: '0 15 * * *', timezone: 'Europe/Helsinki' },
      { id: 'tokyo', userId: 'user-1', cronExpr: '0 15 * * *', timezone: 'Asia/Tokyo' },
    ];

    await service.tick();

    expect(repository.claims).toEqual([
      { automationId: 'helsinki', slot: '2026-07-19T12:00:00.000Z' },
    ]);
  });
});

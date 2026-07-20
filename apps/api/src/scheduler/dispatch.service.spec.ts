import 'reflect-metadata';
import type { WebPushService, PushSendOutcome, PushTarget } from '../notification/web-push.service';
import { DispatchService } from './dispatch.service';
import type {
  DispatchAutomation,
  PendingRun,
  SchedulerRepository,
  SchedulerSubscription,
} from './scheduler.repository';

const NOW = new Date('2026-07-19T12:00:05.000Z');
const SLOT = new Date('2026-07-19T12:00:00.000Z');

const RUN: PendingRun = {
  runId: 'run-1',
  automationId: 'auto-1',
  userId: 'user-1',
  slot: SLOT,
};

function subscription(id: string): SchedulerSubscription {
  return { id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'k', auth: 'a' };
}

class FakeSchedulerRepository {
  automation: DispatchAutomation | null = {
    id: 'auto-1',
    userId: 'user-1',
    enabled: true,
    action: { title: 'Hydration break', body: 'Drink water' },
  };
  subscriptions: SchedulerSubscription[] = [];
  eventAutomations: { id: string }[] = [];
  claims = new Map<string, string>();
  bellFails = false;

  notifications: { userId: string; title: string; body: string | null; automationId: string }[] =
    [];
  statusUpdates: {
    runId: string;
    status: string;
    firedAt: Date | null;
    error: string | null;
  }[] = [];
  pruned: string[] = [];
  claimCalls: { automationId: string; slot: Date }[] = [];

  getAutomationForDispatch(): Promise<DispatchAutomation | null> {
    return Promise.resolve(this.automation);
  }

  insertNotification(
    userId: string,
    title: string,
    body: string | null,
    automationId: string,
  ): Promise<string> {
    if (this.bellFails) {
      return Promise.reject(new Error('insert denied'));
    }
    this.notifications.push({ userId, title, body, automationId });
    return Promise.resolve(`notification-${this.notifications.length}`);
  }

  listSubscriptions(): Promise<SchedulerSubscription[]> {
    return Promise.resolve(this.subscriptions);
  }

  deleteSubscriptionById(id: string): Promise<void> {
    this.pruned.push(id);
    return Promise.resolve();
  }

  updateRunStatus(
    runId: string,
    status: 'sent' | 'failed' | 'skipped',
    firedAt: Date | null,
    error: string | null,
  ): Promise<void> {
    this.statusUpdates.push({ runId, status, firedAt, error });
    return Promise.resolve();
  }

  listEnabledEventAutomations(): Promise<{ id: string }[]> {
    return Promise.resolve(this.eventAutomations);
  }

  claimRun(automationId: string, _userId: string, slot: Date): Promise<string | null> {
    this.claimCalls.push({ automationId, slot });
    return Promise.resolve(this.claims.get(automationId) ?? null);
  }
}

class FakeWebPushService {
  outcomes = new Map<string, PushSendOutcome>();
  sends: { endpoint: string; payload: string }[] = [];

  send(target: PushTarget, payload: string): Promise<PushSendOutcome> {
    this.sends.push({ endpoint: target.endpoint, payload });
    return Promise.resolve(this.outcomes.get(target.endpoint) ?? 'accepted');
  }
}

describe('DispatchService', () => {
  let repository: FakeSchedulerRepository;
  let webPush: FakeWebPushService;
  let service: DispatchService;

  beforeEach(() => {
    repository = new FakeSchedulerRepository();
    webPush = new FakeWebPushService();
    service = new DispatchService(
      repository as unknown as SchedulerRepository,
      webPush as unknown as WebPushService,
    );
    service.now = (): Date => NOW;
  });

  it('writes the bell row, pushes to every subscription, and marks sent', async () => {
    repository.subscriptions = [subscription('a'), subscription('b')];

    await service.dispatchRun(RUN);

    expect(repository.notifications).toEqual([
      { userId: 'user-1', title: 'Hydration break', body: 'Drink water', automationId: 'auto-1' },
    ]);
    expect(webPush.sends).toHaveLength(2);
    expect(repository.statusUpdates).toEqual([
      { runId: 'run-1', status: 'sent', firedAt: NOW, error: null },
    ]);
    // Payload carries what the service worker needs for tag dedupe + deep link.
    const payload = JSON.parse(webPush.sends[0]?.payload ?? '{}') as Record<string, unknown>;
    expect(payload).toMatchObject({
      title: 'Hydration break',
      body: 'Drink water',
      automationId: 'auto-1',
      slot: SLOT.toISOString(),
    });
    expect(typeof payload['notificationId']).toBe('string');
  });

  it('marks sent with zero subscriptions — the bell row IS the delivery', async () => {
    await service.dispatchRun(RUN);

    expect(repository.notifications).toHaveLength(1);
    expect(repository.statusUpdates[0]).toMatchObject({ status: 'sent' });
  });

  it('marks sent when at least one push is accepted', async () => {
    repository.subscriptions = [subscription('dead'), subscription('alive')];
    webPush.outcomes.set(subscription('dead').endpoint, 'failed');

    await service.dispatchRun(RUN);

    expect(repository.statusUpdates[0]).toMatchObject({ status: 'sent', error: null });
  });

  it('marks failed when every push fails, keeping the bell row', async () => {
    repository.subscriptions = [subscription('a'), subscription('b')];
    webPush.outcomes.set(subscription('a').endpoint, 'failed');
    webPush.outcomes.set(subscription('b').endpoint, 'failed');

    await service.dispatchRun(RUN);

    expect(repository.notifications).toHaveLength(1);
    expect(repository.statusUpdates[0]).toMatchObject({
      status: 'failed',
      error: 'all 2 push sends failed',
    });
  });

  it('prunes gone subscriptions without failing the run', async () => {
    repository.subscriptions = [subscription('gone'), subscription('alive')];
    webPush.outcomes.set(subscription('gone').endpoint, 'gone');

    await service.dispatchRun(RUN);

    expect(repository.pruned).toEqual(['gone']);
    expect(repository.statusUpdates[0]).toMatchObject({ status: 'sent' });
  });

  it('skips (no bell, no push) when the automation was disabled before fire', async () => {
    repository.automation = {
      id: 'auto-1',
      userId: 'user-1',
      enabled: false,
      action: { title: 'Hydration break', body: 'Drink water' },
    };
    repository.subscriptions = [subscription('a')];

    await service.dispatchRun(RUN);

    expect(repository.notifications).toHaveLength(0);
    expect(webPush.sends).toHaveLength(0);
    expect(repository.statusUpdates).toEqual([
      { runId: 'run-1', status: 'skipped', firedAt: null, error: null },
    ]);
  });

  it('skips when the automation was deleted before fire', async () => {
    repository.automation = null;

    await service.dispatchRun(RUN);

    expect(repository.statusUpdates[0]).toMatchObject({
      status: 'skipped',
      error: 'automation deleted before fire',
    });
  });

  it('marks failed and sends no push when the bell write fails', async () => {
    repository.bellFails = true;
    repository.subscriptions = [subscription('a')];

    await service.dispatchRun(RUN);

    expect(webPush.sends).toHaveLength(0);
    expect(repository.statusUpdates[0]).toMatchObject({ status: 'failed' });
    expect(repository.statusUpdates[0]?.error).toMatch(/bell write failed/);
  });

  describe('dispatchEventAutomations', () => {
    it('claims with slot = event timestamp and dispatches claimed runs', async () => {
      repository.eventAutomations = [{ id: 'auto-1' }];
      repository.claims.set('auto-1', 'run-9');
      const occurredAt = new Date('2026-07-19T15:04:05.000Z');

      await service.dispatchEventAutomations('user-1', 'task.completed', occurredAt);

      expect(repository.claimCalls).toEqual([{ automationId: 'auto-1', slot: occurredAt }]);
      expect(repository.notifications).toHaveLength(1);
      expect(repository.statusUpdates[0]).toMatchObject({ runId: 'run-9', status: 'sent' });
    });

    it('does nothing for a slot another dispatch already claimed', async () => {
      repository.eventAutomations = [{ id: 'auto-1' }];
      // no claim registered → claimRun returns null

      await service.dispatchEventAutomations(
        'user-1',
        'task.completed',
        new Date('2026-07-19T15:04:05.000Z'),
      );

      expect(repository.notifications).toHaveLength(0);
      expect(repository.statusUpdates).toHaveLength(0);
    });
  });
});

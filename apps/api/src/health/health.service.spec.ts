import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HealthResponseSchema } from '@command-center/contracts';
import { SchedulerRepository, type SchedulerState } from '../scheduler/scheduler.repository';
import { HealthService } from './health.service';

class FakeSchedulerRepository {
  state: SchedulerState | null = null;
  fail = false;

  getState(): Promise<SchedulerState | null> {
    if (this.fail) {
      return Promise.reject(new Error('db unreachable'));
    }
    return Promise.resolve(this.state);
  }
}

describe('HealthService', () => {
  let service: HealthService;
  let schedulerRepository: FakeSchedulerRepository;

  beforeEach(async () => {
    schedulerRepository = new FakeSchedulerRepository();
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: SchedulerRepository, useValue: schedulerRepository }],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it('returns an ok health response matching the contract', async () => {
    const result = await service.getHealth();

    expect(() => HealthResponseSchema.parse(result)).not.toThrow();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(Number.isNaN(Date.parse(result.time))).toBe(false);
  });

  it('reports tick "never" before the first tick', async () => {
    const result = await service.getHealth();
    expect(result.tick).toBe('never');
    expect(result.lastTickAt).toBeNull();
  });

  it('reports tick "ok" for a recent tick and "stale" past the threshold', async () => {
    schedulerRepository.state = {
      cursorAt: new Date(),
      lastTickAt: new Date(Date.now() - 60_000),
    };
    expect((await service.getHealth()).tick).toBe('ok');

    schedulerRepository.state = {
      cursorAt: new Date(),
      lastTickAt: new Date(Date.now() - 6 * 60_000),
    };
    const stale = await service.getHealth();
    expect(stale.tick).toBe('stale');
    expect(stale.lastTickAt).not.toBeNull();
  });

  it('degrades to "unknown" when the state read fails — probe stays green', async () => {
    schedulerRepository.fail = true;
    const result = await service.getHealth();
    expect(result.status).toBe('ok');
    expect(result.tick).toBe('unknown');
  });
});

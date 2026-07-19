import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import webPush, { WebPushError } from 'web-push';
import type { Env } from '../config/env';
import { WebPushService, type PushTarget } from './web-push.service';

jest.mock('web-push', () => {
  class MockWebPushError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return {
    __esModule: true,
    WebPushError: MockWebPushError,
    default: {
      setVapidDetails: jest.fn(),
      sendNotification: jest.fn(),
    },
  };
});

const mockedSend = webPush.sendNotification as jest.Mock;
const mockedSetVapid = webPush.setVapidDetails as jest.Mock;

const ENV: Record<string, string> = {
  VAPID_SUBJECT: 'mailto:owner@example.com',
  VAPID_PUBLIC_KEY: 'public-key',
  VAPID_PRIVATE_KEY: 'private-key',
};

const TARGET: PushTarget = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/super-secret-capability-path',
  p256dh: 'p',
  auth: 'a',
};

describe('WebPushService', () => {
  let service: WebPushService;

  beforeEach(() => {
    jest.clearAllMocks();
    const configService = {
      get: (key: string) => ENV[key],
    } as unknown as ConfigService<Env, true>;
    service = new WebPushService(configService);
  });

  it('configures VAPID lazily, once, and forwards subscription + payload', async () => {
    mockedSend.mockResolvedValue({ statusCode: 201 });

    await service.send(TARGET, '{"title":"t"}');
    await service.send(TARGET, '{"title":"t"}');

    expect(mockedSetVapid).toHaveBeenCalledTimes(1);
    expect(mockedSetVapid).toHaveBeenCalledWith(
      'mailto:owner@example.com',
      'public-key',
      'private-key',
    );
    expect(mockedSend).toHaveBeenCalledWith(
      { endpoint: TARGET.endpoint, keys: { p256dh: 'p', auth: 'a' } },
      '{"title":"t"}',
      expect.objectContaining({ TTL: expect.any(Number) }),
    );
  });

  it('returns accepted on success', async () => {
    mockedSend.mockResolvedValue({ statusCode: 201 });
    await expect(service.send(TARGET, '{}')).resolves.toBe('accepted');
  });

  it.each([404, 410])('maps push-service %d to gone (caller prunes)', async (statusCode) => {
    mockedSend.mockRejectedValue(new WebPushError('gone', statusCode, {}, '', TARGET.endpoint));
    await expect(service.send(TARGET, '{}')).resolves.toBe('gone');
  });

  it.each([400, 413, 429, 500])('maps push-service %d to failed', async (statusCode) => {
    mockedSend.mockRejectedValue(new WebPushError('nope', statusCode, {}, '', TARGET.endpoint));
    await expect(service.send(TARGET, '{}')).resolves.toBe('failed');
  });

  it('maps transport errors to failed instead of throwing', async () => {
    mockedSend.mockRejectedValue(new Error('socket hang up'));
    await expect(service.send(TARGET, '{}')).resolves.toBe('failed');
  });
});

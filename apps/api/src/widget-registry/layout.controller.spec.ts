import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ZodError } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LayoutController } from './layout.controller';
import { LayoutService } from './layout.service';

const user: AuthenticatedUser = {
  id: '00000000-0000-0000-0000-000000000001',
  token: 'jwt',
};

describe('LayoutController', () => {
  let controller: LayoutController;
  let service: jest.Mocked<Pick<LayoutService, 'getLayout' | 'putLayout'>>;

  beforeEach(async () => {
    service = {
      getLayout: jest.fn(),
      putLayout: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [LayoutController],
      providers: [{ provide: LayoutService, useValue: service }],
    }).compile();

    controller = moduleRef.get(LayoutController);
  });

  it('delegates reads to the service', async () => {
    service.getLayout.mockResolvedValue({ items: [] });

    await expect(controller.getLayout(user)).resolves.toEqual({ items: [] });
    expect(service.getLayout).toHaveBeenCalledWith(user);
  });

  it('parses valid layouts (defaulting settings) before delegating', async () => {
    const body = {
      items: [{ widgetId: 'clock', gridPos: { x: 0, y: 0, w: 2, h: 1 } }],
    };

    await controller.putLayout(user, body);

    expect(service.putLayout).toHaveBeenCalledWith(user, {
      items: [{ widgetId: 'clock', gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} }],
    });
  });

  it('rejects unknown top-level fields', () => {
    expect(() => controller.putLayout(user, { items: [], userId: 'someone-else' })).toThrow(
      ZodError,
    );
    expect(service.putLayout).not.toHaveBeenCalled();
  });

  it('rejects malformed grid positions', () => {
    expect(() =>
      controller.putLayout(user, {
        items: [{ widgetId: 'clock', gridPos: { x: -1, y: 0, w: 0, h: 1 } }],
      }),
    ).toThrow(ZodError);
  });
});

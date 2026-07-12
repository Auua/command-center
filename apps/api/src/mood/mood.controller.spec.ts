import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ZodError } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MoodController } from './mood.controller';
import { MoodService } from './mood.service';

const user: AuthenticatedUser = {
  id: '00000000-0000-0000-0000-000000000001',
  token: 'jwt',
};

describe('MoodController', () => {
  let controller: MoodController;
  let service: jest.Mocked<Pick<MoodService, 'listCheckins' | 'createCheckin' | 'deleteCheckin'>>;

  beforeEach(async () => {
    service = {
      listCheckins: jest.fn(),
      createCheckin: jest.fn(),
      deleteCheckin: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [MoodController],
      providers: [{ provide: MoodService, useValue: service }],
    }).compile();

    controller = moduleRef.get(MoodController);
  });

  it('defaults the list window to 7 days', async () => {
    service.listCheckins.mockResolvedValue({ items: [] });

    await expect(controller.listCheckins(user, undefined)).resolves.toEqual({
      items: [],
    });
    expect(service.listCheckins).toHaveBeenCalledWith(user, 7);
  });

  it('parses an explicit ?days= window', async () => {
    service.listCheckins.mockResolvedValue({ items: [] });

    await controller.listCheckins(user, '30');
    expect(service.listCheckins).toHaveBeenCalledWith(user, 30);
  });

  it('rejects a non-numeric or out-of-range window', () => {
    expect(() => controller.listCheckins(user, 'abc')).toThrow(ZodError);
    expect(() => controller.listCheckins(user, '0')).toThrow(ZodError);
    expect(() => controller.listCheckins(user, '365')).toThrow(ZodError);
    expect(service.listCheckins).not.toHaveBeenCalled();
  });

  it('parses create requests, filling defaults', async () => {
    await controller.createCheckin(user, { score: 4 });

    expect(service.createCheckin).toHaveBeenCalledWith(user, {
      score: 4,
      tags: [],
      note: null,
    });
  });

  it('rejects unknown top-level fields on create (reject-unknown-fields)', () => {
    expect(() => controller.createCheckin(user, { score: 4, userId: 'someone-else' })).toThrow(
      ZodError,
    );
    expect(service.createCheckin).not.toHaveBeenCalled();
  });

  it('rejects a missing body and an out-of-range score', () => {
    expect(() => controller.createCheckin(user, undefined)).toThrow(ZodError);
    expect(() => controller.createCheckin(user, { score: 9 })).toThrow(ZodError);
  });

  it('delegates delete to the service', async () => {
    await controller.deleteCheckin(user, 'abc123');
    expect(service.deleteCheckin).toHaveBeenCalledWith(user, 'abc123');
  });
});

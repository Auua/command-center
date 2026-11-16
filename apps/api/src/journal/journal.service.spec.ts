import { ConflictException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { JOURNAL_ENTRY_CREATED_EVENT, type JournalEntry } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ProfileService } from '../profile/profile.service';
import type { JournalPromptsRepository } from './journal-prompts.repository';
import type { JournalRepository } from './journal.repository';
import { JournalService } from './journal.service';

const user: AuthenticatedUser = { id: '00000000-0000-0000-0000-0000000000aa', token: 'jwt' };
const DOC = { type: 'doc' as const, content: [{ type: 'paragraph' as const }] };
const ENTRY: JournalEntry = {
  id: '6740a1b2c3d4e5f601234567',
  entryDate: '2026-11-15',
  textPreview: '',
  wordCount: 0,
  tags: [],
  promptId: null,
  version: 3,
  createdAt: '2026-11-15T21:30:00.000Z',
  updatedAt: '2026-11-15T21:30:00.000Z',
  doc: DOC,
  schemaVersion: 1,
};

function makeService(): {
  service: JournalService;
  entries: Record<'create' | 'updateIfVersion' | 'findById', jest.Mock>;
  emitAsync: jest.Mock;
} {
  const entries = {
    create: jest.fn().mockResolvedValue(ENTRY),
    updateIfVersion: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(ENTRY),
  };
  const emitAsync = jest.fn().mockResolvedValue([]);
  const service = new JournalService(
    entries as unknown as JournalRepository,
    { listActive: jest.fn().mockResolvedValue([]) } as unknown as JournalPromptsRepository,
    { getTimezone: jest.fn().mockResolvedValue('Asia/Tokyo') } as unknown as ProfileService,
    { emitAsync } as unknown as EventEmitter2,
  );
  return { service, entries, emitAsync };
}

describe('JournalService', () => {
  it('dates an undated entry in the home timezone and emits with the request context', async () => {
    const { service, entries, emitAsync } = makeService();
    // 16:00 UTC on the 15th is already the 16th in Tokyo.
    await service.create(
      user,
      { doc: DOC, tags: [], promptId: null },
      new Date('2026-11-15T16:00:00Z'),
    );
    expect(entries.create).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ entryDate: '2026-11-16', version: 1, wordCount: 0 }),
    );
    expect(emitAsync).toHaveBeenCalledWith(
      JOURNAL_ENTRY_CREATED_EVENT,
      expect.objectContaining({ entryId: ENTRY.id }),
      { user },
    );
  });

  it('treats a version that is one ahead with different content as a conflict', async () => {
    const { service } = makeService();
    const other = { type: 'doc' as const, content: [] };
    await expect(service.patch(user, ENTRY.id, { baseVersion: 2, doc: other })).rejects.toThrow(
      ConflictException,
    );
  });

  it('treats a version that is one ahead with the same content as already saved', async () => {
    const { service } = makeService();
    await expect(service.patch(user, ENTRY.id, { baseVersion: 2, doc: DOC })).resolves.toBe(ENTRY);
  });
});

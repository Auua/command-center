import { decodeCursor, encodeCursor } from './cursor';

describe('timeline cursor', () => {
  it('round-trips a position', () => {
    const position = { entryDate: '2026-11-16', id: '6740a1b2c3d4e5f601234567' };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it.each(['', 'bogus', Buffer.from('2026-11-16|nothex').toString('base64url')])(
    'decodes %p to null',
    (cursor) => {
      expect(decodeCursor(cursor)).toBeNull();
    },
  );
});

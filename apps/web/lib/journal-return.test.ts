import { beforeEach, describe, expect, it } from 'vitest';
import { journalListHref, rememberJournalList } from './journal-return';

beforeEach(() => sessionStorage.clear());

describe('journal return address', () => {
  it('is the plain timeline until the timeline records one', () => {
    expect(journalListHref()).toBe('/journal');
  });

  it('returns the recorded search', () => {
    rememberJournalList('/journal?q=heron&tag=birds');
    expect(journalListHref()).toBe('/journal?q=heron&tag=birds');
  });

  it('ignores anything that is not a timeline address', () => {
    sessionStorage.setItem('cc:journal-list', 'https://example.com/journal');
    expect(journalListHref()).toBe('/journal');
    sessionStorage.setItem('cc:journal-list', '/journal/6740a1b2c3d4e5f601234567');
    expect(journalListHref()).toBe('/journal');
  });
});

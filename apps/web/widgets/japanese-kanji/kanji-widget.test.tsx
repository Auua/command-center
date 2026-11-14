import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanjiResponse } from '@command-center/contracts';
import { KanjiWidget, Kunyomi, type KanjiSettings } from './kanji-widget';

vi.mock('@/lib/learning-api', () => ({
  fetchKanji: vi.fn(),
  acknowledgeKanji: vi.fn(),
  skipKanji: vi.fn(),
  fetchAnkiStatus: vi.fn().mockResolvedValue({ configured: false }),
  fetchStreaks: vi.fn().mockResolvedValue({ timezone: 'UTC', streaks: [] }),
}));

import { acknowledgeKanji, fetchKanji, skipKanji } from '@/lib/learning-api';

const fetchMock = vi.mocked(fetchKanji);
const acknowledgeMock = vi.mocked(acknowledgeKanji);
const skipMock = vi.mocked(skipKanji);

const ITEM = {
  itemId: 'Japanese/40 Kanji/Merkit/食.md',
  kanji: '食',
  strokes: 9,
  grade: 2,
  jlpt: 'N5',
  onyomi: ['ショク', 'ジキ'],
  kunyomi: ['た.べる', 'く.う'],
  meaning: { fi: 'syödä, ruoka', en: null },
  components: ['人', '良'],
  lookalikes: ['飲'],
  mnemonic: null as string | null,
  words: [
    {
      itemId: 'Japanese/20 Verbit/Lekseemit/食べる.md',
      word: '食べる',
      reading: 'たべる',
      meaning: { fi: 'syödä', en: null },
      jlpt: 'N5',
      status: 'known',
    },
    {
      itemId: 'Japanese/30 Sanasto/Sanat/食事.md',
      word: '食事',
      reading: 'しょくじ',
      meaning: { fi: 'ateria', en: null },
      jlpt: 'N4',
      status: 'new',
    },
  ],
  status: 'new',
  confidence: 1,
  sourceUrl: 'https://github.com/auua/learning-center/blob/main/x.md',
};

function ok(overrides: Partial<Extract<KanjiResponse, { configured: true }>> = {}): KanjiResponse {
  return {
    configured: true,
    state: 'ok',
    date: '2026-11-14',
    item: ITEM,
    acknowledged: false,
    exhausted: false,
    index: { sha: 'abc', generatedAt: '2026-10-23T08:59:23Z' },
    ...overrides,
  };
}

function renderWidget(
  settings: KanjiSettings = {},
  size = { w: 2, h: 2 },
): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KanjiWidget settings={settings} size={size} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Kunyomi', () => {
  it('splits the okurigana after the vault dot and leaves dotless readings alone', () => {
    const { container } = render(<Kunyomi reading="た.べる" />);
    expect(container.textContent).toBe('たべる');
    expect(container.querySelector('.cc-kanji-okurigana')?.textContent).toBe('べる');
    expect(render(<Kunyomi reading="ひと" />).container.textContent).toBe('ひと');
  });
});

describe('KanjiWidget', () => {
  it('renders the character, meaning, readings, chips, related kanji and words', async () => {
    fetchMock.mockResolvedValue(ok());
    renderWidget();

    const heading = await screen.findByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('食');
    expect(heading).toHaveAttribute('lang', 'ja');
    expect(screen.getByText('syödä, ruoka')).toHaveAttribute('lang', 'fi');
    expect(screen.getByText('ショク・ジキ')).toBeInTheDocument();
    expect(screen.getAllByText('N5').length).toBeGreaterThan(0);
    expect(screen.getByText('Grade 2')).toBeInTheDocument();
    expect(screen.getByText('9 strokes')).toBeInTheDocument();
    expect(screen.getByText('人')).toBeInTheDocument();
    expect(screen.getByText('飲')).toBeInTheDocument();
    expect(screen.getByText('食べる')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'known' })).toBeInTheDocument();
    expect(screen.queryByRole('blockquote')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('N5');
  });

  it('honours the settings: ceiling, hidden components, hidden words; shows a mnemonic when present', async () => {
    fetchMock.mockResolvedValue(
      ok({ item: { ...ITEM, mnemonic: 'Ihminen kumartuu hyvän ruoan päälle.' } }),
    );
    renderWidget({ jlptCeiling: 'N3', showComponents: false, showExampleWords: false });

    expect(await screen.findByText('Ihminen kumartuu hyvän ruoan päälle.')).toBeInTheDocument();
    expect(screen.queryByText('人')).toBeNull();
    expect(screen.queryByText('食べる')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('N3');
  });

  it('caps the words by card height', async () => {
    const base = ITEM.words[1];
    if (!base) throw new Error('fixture');
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...base,
      itemId: `w${index}.md`,
      word: `語${index}`,
    }));
    fetchMock.mockResolvedValue(ok({ item: { ...ITEM, words: many } }));
    const { unmount } = renderWidget({}, { w: 2, h: 2 });
    await screen.findByText('語0');
    expect(screen.queryByText('語3')).toBeNull();
    unmount();

    renderWidget({}, { w: 3, h: 3 });
    expect(await screen.findByText('語5')).toBeInTheDocument();
  });

  it('acknowledges through the API and shows the learned state', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok());
    acknowledgeMock.mockResolvedValue(ok({ acknowledged: true }));
    renderWidget();

    await user.click(await screen.findByRole('button', { name: 'Learned it' }));

    expect(acknowledgeMock).toHaveBeenCalledWith(ITEM.itemId);
    expect(await screen.findByText('Learned — next kanji tomorrow')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Already knew it' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Marked learned');
  });

  it('skips through the API and swaps in the replacement kanji', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok());
    skipMock.mockResolvedValue(ok({ item: { ...ITEM, kanji: '飲', words: [] } }));
    renderWidget();

    await user.click(await screen.findByRole('button', { name: 'Already knew it' }));

    expect(skipMock).toHaveBeenCalledWith(ITEM.itemId, 'N5');
    expect(await screen.findByRole('heading', { level: 3 })).toHaveTextContent('飲');
    expect(screen.getByText('No linked words yet.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('New kanji: 飲');
  });

  it('renders the shared learning states', async () => {
    fetchMock.mockResolvedValue({ configured: false });
    const first = renderWidget();
    expect(await screen.findByText('Learning vault not configured.')).toBeInTheDocument();
    first.unmount();

    fetchMock.mockResolvedValue(ok({ item: null, exhausted: true }));
    const second = renderWidget();
    expect(await screen.findByText(/Nothing new left/)).toBeInTheDocument();
    second.unmount();

    fetchMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(ok());
    const user = userEvent.setup();
    renderWidget();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 3 })).toHaveTextContent('食');
  });
});

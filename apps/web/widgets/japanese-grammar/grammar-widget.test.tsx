import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrammarResponse } from '@command-center/contracts';
import { GrammarWidget, type GrammarSettings } from './grammar-widget';

vi.mock('@/lib/learning-api', () => ({
  fetchGrammarToday: vi.fn(),
  advanceGrammar: vi.fn(),
  studyGrammar: vi.fn(),
  fetchStreaks: vi.fn().mockResolvedValue({
    timezone: 'Europe/Helsinki',
    streaks: [
      {
        streakKey: 'japanese-grammar',
        currentLen: 4,
        bestLen: 9,
        lastActiveDate: '2026-09-18',
        activeToday: true,
        last7: [true, true, true, true, false, true, true],
      },
    ],
  }),
}));

import { advanceGrammar, fetchGrammarToday, studyGrammar } from '@/lib/learning-api';

const fetchMock = vi.mocked(fetchGrammarToday);
const advanceMock = vi.mocked(advanceGrammar);
const studyMock = vi.mocked(studyGrammar);

const ITEM = {
  itemId: 'Japanese/10 Kielioppi/Pisteet/～と.md',
  ja: '～と',
  reading: 'to',
  meaning: { fi: 'kun / aina kun', en: 'whenever / if' },
  jlpt: 'N4',
  func: ['ehto'],
  attaches: ['Sanakirjamuoto', 'ない-muoto'],
  formality: 'neutral',
  register: ['puhuttu'],
  similar: ['～たら (jos, kun)'],
  source: { book: 'Minna no Nihongo I', chapter: 23 },
  status: 'new',
  confidence: 1,
  examples: [
    { ja: '春になると、花が咲きます。', fi: 'Kun tulee kevät, kukat kukkivat.' },
    { ja: 'ボタンを押すと、水が出ます。', fi: 'Kun painat nappia, vesi tulee.' },
  ],
  sourceUrl: 'https://github.com/auua/learning-center/blob/main/x.md',
};

function ok(
  overrides: Partial<Extract<GrammarResponse, { configured: true }>> = {},
): GrammarResponse {
  return {
    configured: true,
    state: 'ok',
    date: '2026-09-18',
    item: ITEM,
    mode: 'new',
    studied: false,
    progress: { seenAtLevel: 12, totalAtLevel: 80 },
    exhausted: false,
    index: { sha: 'abc', generatedAt: '2026-09-18T16:28:45Z' },
    ...overrides,
  };
}

function renderWidget(settings: GrammarSettings = {}, h = 2): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GrammarWidget settings={settings} size={{ w: 3, h }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GrammarWidget', () => {
  it('renders the pattern, meaning, progress, streak pill and one example at the short size', async () => {
    fetchMock.mockResolvedValue(ok());
    renderWidget({ jlptCeiling: 'N4' });

    expect(await screen.findByRole('heading', { level: 3 })).toHaveTextContent('～と');
    expect(screen.getByText('kun / aina kun')).toHaveAttribute('lang', 'fi');
    expect(screen.getByText('N4 · 12/80 seen')).toBeInTheDocument();
    expect(screen.getByText('春になると、花が咲きます。')).toBeInTheDocument();
    expect(screen.queryByText('ボタンを押すと、水が出ます。')).toBeNull();
    expect(await screen.findByText('4-day streak')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('N4');
  });

  it('shows two examples at the tall size and a Review badge in review mode', async () => {
    fetchMock.mockResolvedValue(ok({ mode: 'review' }));
    renderWidget({}, 3);

    expect(await screen.findByText('ボタンを押すと、水が出ます。')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('hides translations behind a disclosure when revealTranslation is tap', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok());
    renderWidget({ revealTranslation: 'tap' });

    await screen.findByRole('heading', { level: 3 });
    expect(screen.queryByText('Kun tulee kevät, kukat kukkivat.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show translation', expanded: false }));
    expect(screen.getByText('Kun tulee kevät, kukat kukkivat.')).toBeInTheDocument();
  });

  it('marks studied through the API and shows the studied state', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok());
    studyMock.mockResolvedValue(ok({ studied: true }));
    renderWidget();

    await user.click(await screen.findByRole('button', { name: 'Mark studied' }));

    expect(studyMock).toHaveBeenCalledWith(ITEM.itemId, 'N5');
    expect(await screen.findByText('Studied — next point tomorrow')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Marked studied');
  });

  it('advances to the next point', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok());
    advanceMock.mockResolvedValue(ok({ item: { ...ITEM, ja: '～ば' } }));
    renderWidget();

    await user.click(await screen.findByRole('button', { name: 'Next point' }));

    expect(advanceMock).toHaveBeenCalledWith(ITEM.itemId, 'N5');
    expect(await screen.findByRole('heading', { level: 3 })).toHaveTextContent('～ば');
  });

  it('renders the not-configured and exhausted states', async () => {
    fetchMock.mockResolvedValue({ configured: false });
    const { unmount } = renderWidget();
    expect(await screen.findByText('Learning vault not configured.')).toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValue(ok({ item: null, exhausted: true }));
    renderWidget();
    expect(await screen.findByText(/Nothing left under this JLPT ceiling/)).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WotdResponse } from '@command-center/contracts';
import { needsRuby, pickMeaning, WotdWidget, type WotdSettings } from './wotd-widget';

vi.mock('@/lib/learning-api', () => ({
  fetchWotd: vi.fn(),
  acknowledgeWotd: vi.fn(),
  skipWotd: vi.fn(),
}));

import { acknowledgeWotd, fetchWotd, skipWotd } from '@/lib/learning-api';

const fetchMock = vi.mocked(fetchWotd);
const acknowledgeMock = vi.mocked(acknowledgeWotd);
const skipMock = vi.mocked(skipWotd);

const ITEM = {
  itemId: 'Japanese/20 Verbit/Lekseemit/負ける.md',
  kind: 'verb' as const,
  word: '負ける',
  reading: 'まける',
  romaji: 'makeru',
  meaning: { fi: 'hävitä', en: 'to lose' },
  jlpt: 'N5',
  pos: null,
  verbclass: 'godan',
  transitivity: 'intransitive',
  status: 'new',
  confidence: 1,
  examples: [{ ja: '試合に負けました。', fi: 'Hävisin ottelun.' }],
  sourceUrl: 'https://github.com/auua/learning-center/blob/main/x.md',
};

function ok(overrides: Partial<Extract<WotdResponse, { configured: true }>> = {}): WotdResponse {
  return {
    configured: true,
    state: 'ok',
    date: '2026-09-18',
    item: ITEM,
    acknowledged: false,
    exhausted: false,
    index: { sha: 'abc', generatedAt: '2026-09-18T16:28:45Z' },
    ...overrides,
  };
}

function renderWidget(settings: WotdSettings = {}): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WotdWidget settings={settings} size={{ w: 2, h: 2 }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('needsRuby / pickMeaning', () => {
  it('adds ruby only for kanji headwords with a distinct reading', () => {
    expect(needsRuby('負ける', 'まける')).toBe(true);
    expect(needsRuby('かける', 'かける')).toBe(false);
    expect(needsRuby('～目', null)).toBe(false);
  });

  it('is Finnish-first with English opt-in and fallback', () => {
    expect(pickMeaning({ fi: 'hävitä', en: 'to lose' }, 'fi')).toEqual({
      text: 'hävitä',
      lang: 'fi',
    });
    expect(pickMeaning({ fi: 'hävitä', en: 'to lose' }, 'en')).toEqual({
      text: 'to lose',
      lang: 'en',
    });
    expect(pickMeaning({ fi: 'hävitä', en: null }, 'en')).toEqual({ text: 'hävitä', lang: 'fi' });
    expect(pickMeaning({ fi: null, en: null }, 'fi').text).toBeNull();
  });
});

describe('WotdWidget', () => {
  it('renders the word with furigana, the Finnish meaning, and the example', async () => {
    fetchMock.mockResolvedValue(ok());
    renderWidget();

    const heading = await screen.findByRole('heading', { level: 3 });
    expect(heading).toHaveAttribute('lang', 'ja');
    expect(heading.querySelector('rt')?.textContent).toBe('まける');
    expect(screen.getByText('hävitä')).toHaveAttribute('lang', 'fi');
    expect(screen.getByText('試合に負けました。')).toBeInTheDocument();
    expect(screen.getByText('N5')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('N5');
  });

  it('honours the settings: ceiling, English meaning, romaji, hidden furigana', async () => {
    fetchMock.mockResolvedValue(ok());
    renderWidget({
      jlptCeiling: 'N3',
      meaningLanguage: 'en',
      showRomaji: true,
      showFurigana: false,
    });

    expect(await screen.findByText('to lose')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('makeru')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 }).querySelector('rt')).toHaveClass(
      'cc-visually-hidden',
    );
    expect(fetchMock).toHaveBeenCalledWith('N3');
  });

  it('acknowledges through the API and shows the learned state', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok());
    acknowledgeMock.mockResolvedValue(ok({ acknowledged: true }));
    renderWidget();

    await user.click(await screen.findByRole('button', { name: 'Learned it' }));

    expect(acknowledgeMock).toHaveBeenCalledWith(ITEM.itemId);
    expect(await screen.findByText('Learned — next word tomorrow')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Already knew it' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Marked learned');
  });

  it('skips through the API and swaps in the replacement word', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok());
    skipMock.mockResolvedValue(ok({ item: { ...ITEM, word: '勝つ', reading: 'かつ' } }));
    renderWidget();

    await user.click(await screen.findByRole('button', { name: 'Already knew it' }));

    expect(skipMock).toHaveBeenCalledWith(ITEM.itemId, 'N5');
    expect(await screen.findByRole('heading', { level: 3 })).toHaveTextContent('勝つ');
    expect(screen.getByRole('status')).toHaveTextContent('New word: 勝つ');
  });

  it('renders the not-configured state with a runbook pointer', async () => {
    fetchMock.mockResolvedValue({ configured: false });
    renderWidget();

    expect(await screen.findByText('Learning vault not configured.')).toBeInTheDocument();
    expect(screen.getByText(/GITHUB_LEARNING_REPO/)).toBeInTheDocument();
  });

  it('renders the exhausted and token-invalid states without actions', async () => {
    fetchMock.mockResolvedValue(ok({ item: null, exhausted: true }));
    const { unmount } = renderWidget();
    expect(await screen.findByText(/Nothing new left/)).toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValue(ok({ state: 'token-invalid', item: null }));
    renderWidget();
    expect(await screen.findByText('GitHub token expired.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a retry on load failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(ok());
    const user = userEvent.setup();
    renderWidget();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 3 })).toHaveTextContent('負ける');
  });
});

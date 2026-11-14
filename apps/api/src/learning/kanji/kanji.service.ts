import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  KANJI_ACKNOWLEDGED_EVENT,
  type DayPin,
  type JlptLevel,
  type KanjiAcknowledgedEvent,
  type KanjiItem,
  type KanjiRecord,
  type KanjiResponse,
  type KanjiWord,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { EventContext } from '../../common/events/event-context';
import { IndexCacheService, type LoadedIndex } from '../index/index-cache.service';
import { LearningAlertsService, STALE_INDEX_MS } from '../learning-alerts.service';
import { ProgressService } from '../progress.service';
import { LearningStateService } from '../state/learning-state.service';
import { VaultClient } from '../vault/vault.client';
import { decidePin, pickReplacement, withOverlay } from '../wotd/selection';
import {
  eligibleKanji,
  isKanjiRecord,
  KANJI_SEED,
  linkCharacters,
  normaliseGrade,
  orderLinkedWords,
  type LinkedWordRecord,
} from './selection';

const KIND = 'kanji';

/**
 * Kanji of the day (ADR-041): WOTD's rails over the kanji shard — eligible
 * set from the index plus the API's own recent writes, day pin in
 * `.cc/state.json`, progress written to the note's front-matter. Linked
 * words come from the index's word side at read time; the mnemonic is an
 * optional index field. Only acknowledge emits an event.
 */
@Injectable()
export class KanjiService {
  private readonly logger = new Logger(KanjiService.name);

  constructor(
    private readonly vault: VaultClient,
    private readonly index: IndexCacheService,
    private readonly state: LearningStateService,
    private readonly progress: ProgressService,
    private readonly alerts: LearningAlertsService,
    private readonly events: EventEmitter2,
  ) {}

  async getToday(user: AuthenticatedUser, ceiling: JlptLevel): Promise<KanjiResponse> {
    if (!this.vault.configured) return { configured: false };
    const today = this.progress.utcToday();
    const loaded = await this.index.get();
    if (!loaded) return this.degraded(user, today);
    await this.checkStaleness(user, loaded);

    let pins;
    try {
      pins = await this.state.readPins();
    } catch (error) {
      this.logger.warn(
        `Pins unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.alerts.raise(user, 'unavailable');
      return this.degraded(user, today, loaded, 'unavailable');
    }

    const eligible = this.eligible(loaded, ceiling);
    const decision = decidePin(
      pins.kinds[KIND],
      today,
      eligible,
      (path) => loaded.byPath.has(path),
      KANJI_SEED,
    );
    if (decision.write && decision.pin) {
      await this.state.writePin(KIND, decision.pin);
    }
    return this.respond(loaded, today, decision.pin, decision.exhausted);
  }

  async acknowledge(user: AuthenticatedUser, itemId: string): Promise<KanjiResponse> {
    if (!this.vault.configured) return { configured: false };
    const { loaded, pin, today } = await this.currentPin(itemId);
    if (pin.resolved) return this.respond(loaded, today, pin, false);

    const reviewed = await this.progress.homeDate(user);
    const current = await this.progress.readNoteProgress(itemId);
    const confidence = Math.max(2, current.confidence ?? 1);
    await this.progress.writeNote(KIND, 'acknowledge', itemId, {
      status: 'learning',
      confidence,
      reviewed,
    });

    const resolved: DayPin = { ...pin, resolved: true };
    await this.state.writePin(KIND, resolved);

    const event: KanjiAcknowledgedEvent = {
      userId: user.id,
      itemId,
      date: pin.date,
      acknowledgedAt: new Date().toISOString(),
    };
    await this.events.emitAsync(KANJI_ACKNOWLEDGED_EVENT, event, { user } satisfies EventContext);

    return this.respond(loaded, today, resolved, false);
  }

  async skip(user: AuthenticatedUser, ceiling: JlptLevel, itemId: string): Promise<KanjiResponse> {
    if (!this.vault.configured) return { configured: false };
    const { loaded, pin, today } = await this.currentPin(itemId);
    if (pin.resolved) return this.respond(loaded, today, pin, false);

    const reviewed = await this.progress.homeDate(user);
    await this.progress.writeNote(KIND, 'skip', itemId, { status: 'known', reviewed });

    const replacement = pickReplacement(this.eligible(loaded, ceiling), itemId, today, KANJI_SEED);
    const next: DayPin = replacement
      ? { date: today, itemId: replacement.path, resolved: false }
      : { ...pin, resolved: true };
    await this.state.writePin(KIND, next);
    return this.respond(loaded, today, next, replacement === null);
  }

  /* ----------------------------------------------------------- internals */

  private eligible(loaded: LoadedIndex, ceiling: JlptLevel): KanjiRecord[] {
    return eligibleKanji(
      loaded.byKind.get('kanji') ?? [],
      (path) => this.state.overlayFor(path),
      ceiling,
    );
  }

  private async currentPin(
    itemId: string,
  ): Promise<{ loaded: LoadedIndex; pin: DayPin; today: string }> {
    const loaded = await this.index.get();
    if (!loaded) throw new ServiceUnavailableException('Learning index is not available');
    const pins = await this.state.readPins(true);
    const pin = pins.kinds[KIND];
    if (!pin || pin.itemId !== itemId) {
      // Stale client (midnight race, or a skip on another device): never
      // resolve the wrong kanji (ADR-011's guard, applied by ADR-041).
      throw new ConflictException('itemId is not the current kanji of the day');
    }
    return { loaded, pin, today: this.progress.utcToday() };
  }

  private async checkStaleness(user: AuthenticatedUser, loaded: LoadedIndex): Promise<void> {
    const generated = Date.parse(loaded.manifest.generatedAt);
    if (!Number.isNaN(generated) && Date.now() - generated > STALE_INDEX_MS) {
      await this.alerts.raise(user, 'index-stale');
    } else {
      this.alerts.clear(user, 'index-stale');
    }
    if (this.index.state === 'token-invalid') {
      await this.alerts.raise(user, 'token-invalid');
    }
  }

  private async degraded(
    user: AuthenticatedUser,
    today: string,
    loaded: LoadedIndex | null = null,
    forced?: 'unavailable',
  ): Promise<KanjiResponse> {
    const state = forced ?? this.index.state;
    if (state === 'token-invalid') await this.alerts.raise(user, 'token-invalid');
    else if (state === 'unavailable') await this.alerts.raise(user, 'unavailable');
    return {
      configured: true,
      state: state === 'ok' ? 'unavailable' : state,
      date: today,
      item: null,
      acknowledged: false,
      exhausted: false,
      index: loaded
        ? { sha: loaded.sha, generatedAt: loaded.manifest.generatedAt }
        : { sha: null, generatedAt: null },
    };
  }

  private respond(
    loaded: LoadedIndex,
    today: string,
    pin: DayPin | null,
    exhausted: boolean,
  ): KanjiResponse {
    const record = pin ? loaded.byPath.get(pin.itemId) : undefined;
    const item = record && isKanjiRecord(record) ? this.toItem(loaded, record) : null;
    return {
      configured: true,
      state: this.index.state === 'token-invalid' ? 'token-invalid' : 'ok',
      date: today,
      item,
      acknowledged: pin?.resolved ?? false,
      exhausted,
      index: { sha: loaded.sha, generatedAt: loaded.manifest.generatedAt },
    };
  }

  private linkedWords(loaded: LoadedIndex, character: string): KanjiWord[] {
    const candidates: LinkedWordRecord[] = [];
    for (const path of loaded.wordsByKanji.get(character) ?? []) {
      const record = loaded.byPath.get(path);
      if (!record || (record.type !== 'vocab' && record.type !== 'verb')) continue;
      const effective = withOverlay(record, this.state.overlayFor(path));
      if (typeof effective.word !== 'string' || effective.word.length === 0) continue;
      candidates.push({
        path: effective.path,
        word: effective.word,
        reading: effective.reading,
        meaning: effective.meaning,
        jlpt: effective.jlpt,
        status: effective.status,
      });
    }
    return orderLinkedWords(candidates).map((word) => ({
      itemId: word.path,
      word: word.word,
      reading: word.reading,
      meaning: word.meaning,
      jlpt: word.jlpt,
      status: word.status,
    }));
  }

  private toItem(loaded: LoadedIndex, record: KanjiRecord): KanjiItem {
    const effective = withOverlay(record, this.state.overlayFor(record.path));
    const character = effective.kanji ?? '';
    return {
      itemId: effective.path,
      kanji: character,
      strokes: effective.strokes,
      grade: normaliseGrade(effective.grade),
      jlpt: effective.jlpt,
      onyomi: effective.onyomi,
      kunyomi: effective.kunyomi,
      meaning: effective.meaning,
      components: linkCharacters(effective.components),
      lookalikes: linkCharacters(effective.lookalikes),
      mnemonic: effective.mnemonic?.trim() ? effective.mnemonic.trim() : null,
      words: this.linkedWords(loaded, character),
      status: effective.status,
      confidence: effective.confidence,
      sourceUrl: this.vault.noteUrl(effective.path),
    };
  }
}

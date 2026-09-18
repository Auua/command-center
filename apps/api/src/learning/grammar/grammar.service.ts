import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  GRAMMAR_STUDIED_EVENT,
  type DayPin,
  type GrammarItem,
  type GrammarRecord,
  type GrammarResponse,
  type GrammarStudiedEvent,
  type JlptLevel,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { EventContext } from '../../common/events/event-context';
import { IndexCacheService, type LoadedIndex } from '../index/index-cache.service';
import { LearningAlertsService } from '../learning-alerts.service';
import { ProgressService } from '../progress.service';
import { LearningStateService } from '../state/learning-state.service';
import { VaultClient } from '../vault/vault.client';
import { withOverlay } from '../wotd/selection';
import {
  decideGrammarPin,
  eligibleGrammar,
  isGrammarRecord,
  progressAtLevel,
  reviewCandidates,
} from './selection';

const KIND = 'grammar';
const LINK_RE = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/;

/** `[[Vertailu — X|label]]` → `label` / `X`; anything else verbatim. */
export function linkText(value: string): string {
  const match = LINK_RE.exec(value.trim());
  return match ? (match[2] ?? match[1] ?? value).trim() : value;
}

/**
 * Grammar point of the day (ADR-012 as amended by ADR-040): sequenced
 * selection from the vault index, review rotation when exhausted, progress
 * written to the note. "Mark studied" is the only streak source; "next
 * point" only stamps `reviewed`.
 */
@Injectable()
export class GrammarService {
  private readonly logger = new Logger(GrammarService.name);

  constructor(
    private readonly vault: VaultClient,
    private readonly index: IndexCacheService,
    private readonly state: LearningStateService,
    private readonly progress: ProgressService,
    private readonly alerts: LearningAlertsService,
    private readonly events: EventEmitter2,
  ) {}

  async getToday(user: AuthenticatedUser, ceiling: JlptLevel): Promise<GrammarResponse> {
    if (!this.vault.configured) return { configured: false };
    const today = this.progress.utcToday();
    const loaded = await this.index.get();
    if (!loaded) return this.degraded(user, today, ceiling);

    let pins;
    try {
      pins = await this.state.readPins();
    } catch (error) {
      this.logger.warn(
        `Pins unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.alerts.raise(user, 'unavailable');
      return this.degraded(user, today, ceiling, loaded);
    }

    const decision = decideGrammarPin(
      pins.kinds[KIND],
      today,
      this.eligible(loaded, ceiling),
      this.review(loaded, ceiling),
      (path) => loaded.byPath.has(path),
    );
    if (decision.write && decision.pin) await this.state.writePin(KIND, decision.pin);
    return this.respond(loaded, today, ceiling, decision.pin, decision.mode, decision.exhausted);
  }

  /** "Next point": stamp `reviewed` on the current point and pin the next one. */
  async advance(
    user: AuthenticatedUser,
    ceiling: JlptLevel,
    itemId: string,
  ): Promise<GrammarResponse> {
    if (!this.vault.configured) return { configured: false };
    const { loaded, pin, today } = await this.currentPin(itemId);
    const reviewed = await this.progress.homeDate(user);
    await this.progress.writeNote(KIND, 'advance', itemId, { reviewed });

    const decision = decideGrammarPin(
      undefined,
      today,
      this.eligible(loaded, ceiling),
      this.review(loaded, ceiling),
      (path) => loaded.byPath.has(path),
      itemId,
    );
    const next: DayPin = decision.pin ?? { ...pin, resolved: true };
    await this.state.writePin(KIND, next);
    return this.respond(loaded, today, ceiling, next, decision.mode, decision.exhausted);
  }

  /** "Mark studied": progress like WOTD's acknowledge, emits `grammar.studied`. */
  async studied(
    user: AuthenticatedUser,
    ceiling: JlptLevel,
    itemId: string,
  ): Promise<GrammarResponse> {
    if (!this.vault.configured) return { configured: false };
    const { loaded, pin, today } = await this.currentPin(itemId);
    if (pin.resolved) return this.respond(loaded, today, ceiling, pin, pin.mode ?? 'new', false);

    const reviewed = await this.progress.homeDate(user);
    const current = await this.progress.readNoteProgress(itemId);
    const confidence = Math.max(2, current.confidence ?? 1);
    await this.progress.writeNote(KIND, 'studied', itemId, {
      status: 'learning',
      confidence,
      reviewed,
    });

    const resolved: DayPin = { ...pin, resolved: true };
    await this.state.writePin(KIND, resolved);

    const event: GrammarStudiedEvent = {
      userId: user.id,
      itemId,
      date: pin.date,
      studiedAt: new Date().toISOString(),
    };
    await this.events.emitAsync(GRAMMAR_STUDIED_EVENT, event, { user } satisfies EventContext);
    return this.respond(loaded, today, ceiling, resolved, pin.mode ?? 'new', false);
  }

  /* ----------------------------------------------------------- internals */

  private records(loaded: LoadedIndex): GrammarRecord[] {
    return (loaded.byKind.get('grammar') ?? []).filter(isGrammarRecord);
  }

  private eligible(loaded: LoadedIndex, ceiling: JlptLevel): GrammarRecord[] {
    return eligibleGrammar(this.records(loaded), (path) => this.state.overlayFor(path), ceiling);
  }

  private review(loaded: LoadedIndex, ceiling: JlptLevel): GrammarRecord[] {
    return reviewCandidates(this.records(loaded), (path) => this.state.overlayFor(path), ceiling);
  }

  private async currentPin(
    itemId: string,
  ): Promise<{ loaded: LoadedIndex; pin: DayPin; today: string }> {
    const loaded = await this.index.get();
    if (!loaded) throw new ServiceUnavailableException('Learning index is not available');
    const pins = await this.state.readPins(true);
    const pin = pins.kinds[KIND];
    if (!pin || pin.itemId !== itemId) {
      throw new ConflictException('itemId is not the current grammar point');
    }
    return { loaded, pin, today: this.progress.utcToday() };
  }

  private async degraded(
    user: AuthenticatedUser,
    today: string,
    ceiling: JlptLevel,
    loaded: LoadedIndex | null = null,
  ): Promise<GrammarResponse> {
    const state = this.index.state;
    if (state === 'token-invalid') await this.alerts.raise(user, 'token-invalid');
    else await this.alerts.raise(user, 'unavailable');
    return {
      configured: true,
      state: state === 'ok' ? 'unavailable' : state,
      date: today,
      item: null,
      mode: 'new',
      studied: false,
      progress: loaded
        ? progressAtLevel(this.records(loaded), (path) => this.state.overlayFor(path), ceiling)
        : { seenAtLevel: 0, totalAtLevel: 0 },
      exhausted: false,
      index: loaded
        ? { sha: loaded.sha, generatedAt: loaded.manifest.generatedAt }
        : { sha: null, generatedAt: null },
    };
  }

  private respond(
    loaded: LoadedIndex,
    today: string,
    ceiling: JlptLevel,
    pin: DayPin | null,
    mode: 'new' | 'review',
    exhausted: boolean,
  ): GrammarResponse {
    const record = pin ? loaded.byPath.get(pin.itemId) : undefined;
    const item = record && isGrammarRecord(record) ? this.toItem(record) : null;
    return {
      configured: true,
      state: this.index.state === 'token-invalid' ? 'token-invalid' : 'ok',
      date: today,
      item,
      mode,
      studied: pin?.resolved ?? false,
      progress: progressAtLevel(
        this.records(loaded),
        (path) => this.state.overlayFor(path),
        ceiling,
      ),
      exhausted,
      index: { sha: loaded.sha, generatedAt: loaded.manifest.generatedAt },
    };
  }

  private toItem(record: GrammarRecord): GrammarItem {
    const effective = withOverlay(record, this.state.overlayFor(record.path));
    return {
      itemId: effective.path,
      ja: effective.ja ?? '',
      reading: effective.reading,
      meaning: effective.meaning,
      jlpt: effective.jlpt,
      func: effective.func,
      attaches: effective.attaches.map(linkText),
      formality: effective.formality,
      register: effective.register,
      similar: effective.similar.map(linkText),
      source: effective.source,
      status: effective.status,
      confidence: effective.confidence,
      examples: effective.examples
        .filter(
          (example): example is typeof example & { ja: string } => typeof example.ja === 'string',
        )
        .map((example) => ({ ja: example.ja, fi: example.fi })),
      sourceUrl: this.vault.noteUrl(effective.path),
    };
  }
}

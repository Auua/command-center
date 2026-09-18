import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  WOTD_ACKNOWLEDGED_EVENT,
  type DayPin,
  type IndexRecord,
  type JlptLevel,
  type WotdAcknowledgedEvent,
  type WotdItem,
  type WotdResponse,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { EventContext } from '../../common/events/event-context';
import { IndexCacheService, type LoadedIndex } from '../index/index-cache.service';
import { LearningAlertsService, STALE_INDEX_MS } from '../learning-alerts.service';
import { ProgressService } from '../progress.service';
import { LearningStateService } from '../state/learning-state.service';
import { VaultClient } from '../vault/vault.client';
import {
  decidePin,
  eligibleWotd,
  isWotdRecord,
  pickReplacement,
  withOverlay,
  type WotdRecord,
} from './selection';

const KIND = 'wotd';

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Word of the day (ADR-011 as amended by ADR-040): the eligible set comes
 * from the vault index (+ the API's own recent writes), the day pin lives in
 * `.cc/state.json`, and progress is written into the note's front-matter.
 * Only acknowledge emits an event — the sole WOTD streak source.
 */
@Injectable()
export class WotdService {
  private readonly logger = new Logger(WotdService.name);

  constructor(
    private readonly vault: VaultClient,
    private readonly index: IndexCacheService,
    private readonly state: LearningStateService,
    private readonly progress: ProgressService,
    private readonly alerts: LearningAlertsService,
    private readonly events: EventEmitter2,
  ) {}

  async getToday(user: AuthenticatedUser, ceiling: JlptLevel): Promise<WotdResponse> {
    if (!this.vault.configured) return { configured: false };
    const today = utcToday();
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
    const decision = decidePin(pins.kinds[KIND], today, eligible, (path) =>
      loaded.byPath.has(path),
    );
    if (decision.write && decision.pin) {
      await this.state.writePin(KIND, decision.pin);
    }
    return this.respond(loaded, today, decision.pin, decision.exhausted);
  }

  async acknowledge(user: AuthenticatedUser, itemId: string): Promise<WotdResponse> {
    if (!this.vault.configured) return { configured: false };
    const { loaded, pin, today } = await this.currentPin(itemId);
    if (pin.resolved) {
      return this.respond(loaded, today, pin, false);
    }

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

    const event: WotdAcknowledgedEvent = {
      userId: user.id,
      itemId,
      date: pin.date,
      acknowledgedAt: new Date().toISOString(),
    };
    await this.events.emitAsync(WOTD_ACKNOWLEDGED_EVENT, event, { user } satisfies EventContext);

    return this.respond(loaded, today, resolved, false);
  }

  async skip(user: AuthenticatedUser, ceiling: JlptLevel, itemId: string): Promise<WotdResponse> {
    if (!this.vault.configured) return { configured: false };
    const { loaded, pin, today } = await this.currentPin(itemId);
    if (pin.resolved) {
      return this.respond(loaded, today, pin, false);
    }

    const reviewed = await this.progress.homeDate(user);
    await this.progress.writeNote(KIND, 'skip', itemId, { status: 'known', reviewed });

    const replacement = pickReplacement(this.eligible(loaded, ceiling), itemId, today);
    const next: DayPin = replacement
      ? { date: today, itemId: replacement.path, resolved: false }
      : { ...pin, resolved: true };
    await this.state.writePin(KIND, next);
    return this.respond(loaded, today, next, replacement === null);
  }

  /* ----------------------------------------------------------- internals */

  private eligible(loaded: LoadedIndex, ceiling: JlptLevel): WotdRecord[] {
    const records = [...(loaded.byKind.get('vocab') ?? []), ...(loaded.byKind.get('verb') ?? [])];
    return eligibleWotd(records, (path) => this.state.overlayFor(path), ceiling);
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
      // resolve the wrong word (ADR-011).
      throw new ConflictException('itemId is not the current word of the day');
    }
    return { loaded, pin, today: utcToday() };
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
  ): Promise<WotdResponse> {
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
  ): WotdResponse {
    const record = pin ? loaded.byPath.get(pin.itemId) : undefined;
    const item = record && isWotdRecord(record) ? this.toItem(record) : null;
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

  private toItem(record: IndexRecord & WotdRecord): WotdItem {
    const effective = withOverlay(record, this.state.overlayFor(record.path));
    return {
      itemId: effective.path,
      kind: effective.type,
      word: effective.word ?? '',
      reading: effective.reading,
      romaji: effective.romaji,
      meaning: effective.meaning,
      jlpt: effective.jlpt,
      pos: effective.type === 'vocab' ? effective.pos : null,
      verbclass: effective.type === 'verb' ? effective.verbclass : null,
      transitivity: effective.type === 'verb' ? effective.transitivity : null,
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

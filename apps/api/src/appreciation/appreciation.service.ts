import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AppreciationEntry,
  AppreciationExport,
  AppreciationListResponse,
  AppreciationPromptLocale,
  AppreciationPromptToday,
  CreateAppreciationRequest,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ProfileService } from '../profile/profile.service';
import { AppreciationRepository } from './appreciation.repository';
import { localDateIn, pickPrompt, promptText } from '../common/daily-prompt';

/**
 * Business rules for the appreciation tracker (ADR-017; controllers stay
 * thin — ADR §4.1). A malformed or foreign entry id is deliberately
 * indistinguishable from a missing one: both 404.
 */
@Injectable()
export class AppreciationService {
  constructor(
    private readonly repository: AppreciationRepository,
    private readonly profile: ProfileService,
  ) {}

  async list(user: AuthenticatedUser, limit: number): Promise<AppreciationListResponse> {
    return { items: await this.repository.listRecentForUser(user, limit) };
  }

  create(user: AuthenticatedUser, request: CreateAppreciationRequest): Promise<AppreciationEntry> {
    return this.repository.createForUser(user, { text: request.text, tags: request.tags });
  }

  async delete(user: AuthenticatedUser, id: string): Promise<void> {
    if (!(await this.repository.deleteForUser(user, id))) {
      throw new NotFoundException(`Appreciation entry "${id}" not found`);
    }
  }

  async export(user: AuthenticatedUser, now: Date = new Date()): Promise<AppreciationExport> {
    return {
      exportedAt: now.toISOString(),
      items: await this.repository.listAllForUser(user),
    };
  }

  /**
   * The day's prompt in the user's home timezone (ProfileModule; UTC before
   * the timezone is captured). 404 when no prompt is active — the widget
   * then shows its neutral placeholder.
   */
  async promptToday(
    user: AuthenticatedUser,
    locale: AppreciationPromptLocale,
    now: Date = new Date(),
  ): Promise<AppreciationPromptToday> {
    const [timezone, prompts] = await Promise.all([
      this.profile.getTimezone(user),
      this.repository.listActivePrompts(user),
    ]);
    const date = localDateIn(timezone, now);
    const usable = prompts.flatMap((prompt) => {
      const text = promptText(prompt.text, locale);
      return text ? [{ id: prompt.id, text }] : [];
    });
    const pick = pickPrompt(usable, user.id, date);
    if (!pick) throw new NotFoundException('No active appreciation prompt');
    return { ...pick, date };
  }
}

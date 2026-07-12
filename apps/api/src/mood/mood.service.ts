import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateMoodCheckinRequest,
  MoodCheckin,
  MoodCheckinListResponse,
} from "@command-center/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { MoodRepository } from "./mood.repository";

const DAY_MS = 86_400_000;

/**
 * Business rules for mood check-ins (controllers stay thin — ARD §4.1).
 * The list window is timestamp-based (`days` back from now); calendar-day
 * bucketing for trends happens client-side in the user's own timezone.
 *
 * A malformed or foreign check-in id is deliberately indistinguishable from
 * a missing one: both 404, nothing leaks about other users' data.
 */
@Injectable()
export class MoodService {
  constructor(private readonly moodRepository: MoodRepository) {}

  async listCheckins(
    user: AuthenticatedUser,
    days: number,
  ): Promise<MoodCheckinListResponse> {
    const since = new Date(Date.now() - days * DAY_MS).toISOString();
    const items = await this.moodRepository.listSinceForUser(user, since);
    return { items };
  }

  createCheckin(
    user: AuthenticatedUser,
    request: CreateMoodCheckinRequest,
  ): Promise<MoodCheckin> {
    return this.moodRepository.createForUser(user, {
      mood_score: request.score,
      tags: request.tags,
      note: request.note,
    });
  }

  async deleteCheckin(user: AuthenticatedUser, id: string): Promise<void> {
    const deleted = await this.moodRepository.deleteForUser(user, id);
    if (!deleted) {
      throw new NotFoundException(`Mood check-in "${id}" not found`);
    }
  }
}

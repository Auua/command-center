import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  BraindumpListResponse,
  BraindumpNote,
  CreateBraindumpNoteRequest,
  UpdateBraindumpNoteRequest,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BraindumpRepository } from './braindump.repository';

/**
 * Business rules for braindump notes (controllers stay thin — ARD §4.1).
 * A malformed or foreign note id is deliberately indistinguishable from a
 * missing one: both 404, nothing leaks about other users' data.
 */
@Injectable()
export class BraindumpService {
  constructor(private readonly braindumpRepository: BraindumpRepository) {}

  async listNotes(user: AuthenticatedUser): Promise<BraindumpListResponse> {
    const items = await this.braindumpRepository.listForUser(user.id);
    return { items };
  }

  createNote(user: AuthenticatedUser, request: CreateBraindumpNoteRequest): Promise<BraindumpNote> {
    return this.braindumpRepository.createForUser(user.id, request.content);
  }

  async updateNote(
    user: AuthenticatedUser,
    id: string,
    request: UpdateBraindumpNoteRequest,
  ): Promise<BraindumpNote> {
    const note = await this.braindumpRepository.updateContentForUser(user.id, id, request.content);
    if (!note) {
      throw new NotFoundException(`Braindump note "${id}" not found`);
    }
    return note;
  }

  async deleteNote(user: AuthenticatedUser, id: string): Promise<void> {
    const deleted = await this.braindumpRepository.deleteForUser(user.id, id);
    if (!deleted) {
      throw new NotFoundException(`Braindump note "${id}" not found`);
    }
  }
}

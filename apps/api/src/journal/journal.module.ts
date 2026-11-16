import { Module } from '@nestjs/common';
import { MongoModule } from '../mongo/mongo.module';
import { ProfileModule } from '../profile/profile.module';
import { JournalPromptsRepository } from './journal-prompts.repository';
import { JournalController } from './journal.controller';
import { JournalRepository } from './journal.repository';
import { JournalService } from './journal.service';

/**
 * JournalModule (ADR-016): rich-text entries and the seeded daily prompts.
 * Owns the Mongo collections `journal_entries` and `journal_prompts`
 * exclusively (ADR-002); reads the home timezone through ProfileModule's
 * exported service. Streaks react to `journal.entry_created` — this module
 * imports neither streaks nor automations.
 */
@Module({
  imports: [MongoModule, ProfileModule],
  controllers: [JournalController],
  providers: [JournalService, JournalRepository, JournalPromptsRepository],
})
export class JournalModule {}

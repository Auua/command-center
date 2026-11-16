import { Module } from '@nestjs/common';
import { MongoModule } from '../mongo/mongo.module';
import { ProfileModule } from '../profile/profile.module';
import { JournalPromptsRepository } from './journal-prompts.repository';
import { JournalSearchService } from './journal-search.service';
import { JournalController } from './journal.controller';
import { JournalRepository } from './journal.repository';
import { JournalService } from './journal.service';

/**
 * JournalModule (ADR-016): rich-text entries, the seeded daily prompts and
 * full-text search (the Atlas Search index `journal_search`, which the
 * module creates itself).
 * Owns the Mongo collections `journal_entries` and `journal_prompts`
 * exclusively (ADR-002); reads the home timezone through ProfileModule's
 * exported service. Streaks react to `journal.entry_created` — this module
 * imports neither streaks nor automations.
 */
@Module({
  imports: [MongoModule, ProfileModule],
  controllers: [JournalController],
  providers: [JournalService, JournalSearchService, JournalRepository, JournalPromptsRepository],
})
export class JournalModule {}

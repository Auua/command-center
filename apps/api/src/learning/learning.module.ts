import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ProfileModule } from '../profile/profile.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { GrammarService } from './grammar/grammar.service';
import { IndexCacheService } from './index/index-cache.service';
import { LearningAlertsService } from './learning-alerts.service';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';
import { ProgressService } from './progress.service';
import { LearningStateService } from './state/learning-state.service';
import { StreaksController } from './streaks/streaks.controller';
import { StreaksRepository } from './streaks/streaks.repository';
import { StreaksService } from './streaks/streaks.service';
import { VaultClient } from './vault/vault.client';
import { WotdService } from './wotd/wotd.service';

/**
 * LearningModule (ADR-024 as amended by ADR-040): owns the learning-center
 * vault — the only module that talks to GitHub. Reads the vault-generated
 * `.cc/index`, writes progress into note front-matter and day pins into
 * `.cc/state.json`. ProfileModule supplies the home timezone for the
 * `reviewed` date; NotificationModule's repository takes the
 * `source: 'learning'` bell rows. StreaksService (ADR-014) lives here too and
 * owns `streaks` + `streak_days` — the module's only Postgres tables.
 */
@Module({
  imports: [SupabaseModule, ProfileModule, NotificationModule],
  controllers: [LearningController, StreaksController],
  providers: [
    VaultClient,
    IndexCacheService,
    LearningStateService,
    LearningAlertsService,
    LearningService,
    ProgressService,
    WotdService,
    GrammarService,
    StreaksRepository,
    StreaksService,
  ],
})
export class LearningModule {}

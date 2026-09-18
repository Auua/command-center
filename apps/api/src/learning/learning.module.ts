import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ProfileModule } from '../profile/profile.module';
import { IndexCacheService } from './index/index-cache.service';
import { LearningAlertsService } from './learning-alerts.service';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';
import { LearningStateService } from './state/learning-state.service';
import { VaultClient } from './vault/vault.client';
import { WotdService } from './wotd/wotd.service';

/**
 * LearningModule (ADR-024 as amended by ADR-040): owns the learning-center
 * vault — the only module that talks to GitHub. Reads the vault-generated
 * `.cc/index`, writes progress into note front-matter and day pins into
 * `.cc/state.json`. ProfileModule supplies the home timezone for the
 * `reviewed` date; NotificationModule's repository takes the
 * `source: 'learning'` bell rows. No Postgres table of its own.
 */
@Module({
  imports: [ProfileModule, NotificationModule],
  controllers: [LearningController],
  providers: [
    VaultClient,
    IndexCacheService,
    LearningStateService,
    LearningAlertsService,
    LearningService,
    WotdService,
  ],
})
export class LearningModule {}

import { Module } from '@nestjs/common';
import { MongoModule } from '../mongo/mongo.module';
import { BraindumpController } from './braindump.controller';
import { BraindumpRepository } from './braindump.repository';
import { BraindumpService } from './braindump.service';

/**
 * BraindumpModule (ADR §4.1): first MongoDB-backed domain module — validates
 * ADR-003 (dual-DB split) early. Owns the `braindump_notes` collection
 * exclusively; no other module may touch it (module ownership rule, ADR-002).
 */
@Module({
  imports: [MongoModule],
  controllers: [BraindumpController],
  providers: [BraindumpService, BraindumpRepository],
})
export class BraindumpModule {}

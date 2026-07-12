import { Module } from "@nestjs/common";
import { MongoService } from "./mongo.service";

/**
 * Core MongoDB access (ARD §4.3). Domain modules import this to obtain their
 * own collections; collection ownership stays with the domain module
 * (one owner per collection, ADR-003).
 */
@Module({
  providers: [MongoService],
  exports: [MongoService],
})
export class MongoModule {}

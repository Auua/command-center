import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { LayoutController } from "./layout.controller";
import { LayoutRepository } from "./layout.repository";
import { LayoutService } from "./layout.service";

/**
 * WidgetRegistryModule (ARD §4.1): owns dashboard layout + per-widget
 * settings persistence. Owns its repository exclusively — no other module
 * may touch `widget_layouts` (module ownership rule, ADR-002).
 */
@Module({
  imports: [SupabaseModule],
  controllers: [LayoutController],
  providers: [LayoutService, LayoutRepository],
})
export class WidgetRegistryModule {}

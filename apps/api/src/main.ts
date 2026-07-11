import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createApp } from "./bootstrap";
import type { Env } from "./config/env";

/**
 * API process entrypoint (ARD §3.1). App wiring lives in bootstrap.ts so the
 * Vercel serverless entry (api/index.ts) can reuse it without listening.
 */
async function bootstrap(): Promise<void> {
  const app = await createApp();

  const configService = app.get<ConfigService<Env, true>>(ConfigService);
  const port = configService.get("PORT", { infer: true });

  await app.listen(port);
  new Logger("Bootstrap").log(
    `API listening on port ${port} (prefix /api/v1, public /health)`,
  );
}

void bootstrap();

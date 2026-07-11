import "reflect-metadata";
import { ConsoleLogger, RequestMethod } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { ZodExceptionFilter } from "./common/filters/zod-exception.filter";
import type { Env } from "./config/env";

/**
 * Builds the fully configured Nest application without binding a port, so the
 * same setup serves both the long-running server (main.ts) and the Vercel
 * serverless entry (api/index.ts). Structured JSON logs (NFR-10), CORS
 * restricted to configured origins (ARD §5.2), global prefix /api/v1 with the
 * public /health probe excluded.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });

  const configService = app.get<ConfigService<Env, true>>(ConfigService);
  const corsOrigins = configService
    .get("CORS_ORIGIN", { infer: true })
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  // Minimal helmet-style hardening; the full CSP story lives in the web app
  // middleware (ARD §5.2). Kept dependency-free for Phase 0.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.disable("x-powered-by");

  app.useGlobalFilters(new ZodExceptionFilter());
  app.enableShutdownHooks();

  return app;
}

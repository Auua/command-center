import type { IncomingMessage, ServerResponse } from "node:http";
// Imports the tsc-compiled output rather than src/ — Nest's DI needs
// emitDecoratorMetadata, which Vercel's function bundler does not emit. The
// buildCommand in vercel.json produces dist/ before functions are bundled.
import { createApp } from "../dist/bootstrap";

type ExpressListener = (req: IncomingMessage, res: ServerResponse) => void;

let listener: Promise<ExpressListener> | undefined;

async function getListener(): Promise<ExpressListener> {
  const app = await createApp();
  await app.init();
  return app.getHttpAdapter().getInstance();
}

// Boots the Nest app once per instance and delegates each request to the
// underlying Express listener. req.url keeps the original path (e.g.
// /api/v1/…, /health) thanks to the catch-all rewrite in vercel.json.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  listener ??= getListener();
  (await listener)(req, res);
}

import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ConfigService } from "@nestjs/config";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import type { Env } from "../config/env";
import { JwtVerifierService } from "./jwt-verifier.service";

function makeConfig(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

async function signEs256Token(
  privateKey: KeyLike,
  kid: string,
): Promise<string> {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid })
    .setSubject("user-1")
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("JwtVerifierService", () => {
  const kid = "test-key-1";
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    keys = await generateKeyPair("ES256", { extractable: true });
    const jwk = { ...(await exportJWK(keys.publicKey)), kid, alg: "ES256" };
    server = http.createServer((req, res) => {
      if (req.url === "/auth/v1/.well-known/jwks.json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: [jwk] }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("verifies an ES256 token against the project JWKS", async () => {
    const service = new JwtVerifierService(
      makeConfig({ SUPABASE_URL: baseUrl }),
    );
    const token = await signEs256Token(keys.privateKey, kid);

    await expect(service.verify(token)).resolves.toMatchObject({
      sub: "user-1",
      aud: "authenticated",
    });
  });

  it("rejects tokens signed by a different key", async () => {
    const service = new JwtVerifierService(
      makeConfig({ SUPABASE_URL: baseUrl }),
    );
    const otherKeys = await generateKeyPair("ES256");
    const token = await signEs256Token(otherKeys.privateKey, kid);

    await expect(service.verify(token)).rejects.toThrow();
  });

  it("rejects tokens with the wrong audience", async () => {
    const service = new JwtVerifierService(
      makeConfig({ SUPABASE_URL: baseUrl }),
    );
    const token = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid })
      .setSubject("user-1")
      .setAudience("something-else")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);

    await expect(service.verify(token)).rejects.toThrow(/"aud" claim/);
  });
});

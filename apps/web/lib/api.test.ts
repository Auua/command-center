import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";

const createClientMock = vi.mocked(createClient);

function mockSession(accessToken: string | null): void {
  createClientMock.mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: accessToken ? { access_token: accessToken } : null,
        },
      }),
    },
  } as unknown as ReturnType<typeof createClient>);
}

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("apiFetch", () => {
  it("sends the Supabase access token as Bearer auth", async () => {
    mockSession("token-123");

    await apiFetch("/api/v1/braindump");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v1/braindump",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
      }),
    );
  });

  it("JSON-encodes bodies and sets the content type", async () => {
    mockSession("token-123");

    await apiFetch("/api/v1/braindump", {
      method: "POST",
      body: { content: "hi" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ content: "hi" }));
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("does not set a content type on body-less requests", async () => {
    mockSession("token-123");

    await apiFetch("/api/v1/braindump");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init).not.toHaveProperty("body");
  });

  it("throws before fetching when there is no session", async () => {
    mockSession(null);

    await expect(apiFetch("/api/v1/braindump")).rejects.toThrow(
      /no active session/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on non-2xx responses with the path and status", async () => {
    mockSession("token-123");
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(apiFetch("/api/v1/braindump")).rejects.toThrow(
      /\/api\/v1\/braindump failed with status 500/,
    );
  });
});

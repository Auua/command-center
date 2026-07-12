import { UserThrottlerGuard } from "./user-throttler.guard";

/**
 * getTracker is self-contained, so the guard is constructed with dummy
 * throttler wiring — only the tracker key derivation is under test.
 */
function makeGuard(): UserThrottlerGuard {
  return new UserThrottlerGuard(
    {} as never, // options
    {} as never, // storage
    {} as never, // reflector
  );
}

describe("UserThrottlerGuard", () => {
  it("tracks authenticated requests by user id", async () => {
    const guard = makeGuard();
    const key = await guard["getTracker"]({
      user: { id: "user-7", token: "t" },
      ip: "1.2.3.4",
    });
    expect(key).toBe("user:user-7");
  });

  it("falls back to the client IP on public routes", async () => {
    const guard = makeGuard();
    await expect(guard["getTracker"]({ ip: "1.2.3.4" })).resolves.toBe(
      "ip:1.2.3.4",
    );
  });

  it("never produces an empty tracker key", async () => {
    const guard = makeGuard();
    await expect(guard["getTracker"]({})).resolves.toBe("ip:unknown");
  });
});

import { InternalServerErrorException } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { SupabaseService } from "../supabase/supabase.service";
import { LayoutRepository } from "./layout.repository";

const user: AuthenticatedUser = {
  id: "00000000-0000-0000-0000-000000000001",
  token: "jwt",
};

/**
 * Chainable stub for the supabase-js query builder. Every method returns the
 * chain; awaiting it resolves to `result` (the builder is a thenable).
 */
function chain(result: {
  data?: unknown;
  error: { message: string } | null;
}): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "delete", "insert"]) {
    c[method] = jest.fn(() => c);
  }
  c.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown> => Promise.resolve(result).then(resolve, reject);
  return c;
}

function makeRepository(...chains: ReturnType<typeof chain>[]): {
  repo: LayoutRepository;
  from: jest.Mock;
  supabaseService: SupabaseService;
} {
  const from = jest.fn();
  for (const c of chains) {
    from.mockReturnValueOnce(c);
  }
  const client = { from };
  const supabaseService = {
    forUser: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;
  return { repo: new LayoutRepository(supabaseService), from, supabaseService };
}

const ROW = {
  widget_id: "clock",
  grid_pos: { x: 0, y: 0, w: 2, h: 1 },
  settings: { hour12: true },
};

describe("LayoutRepository", () => {
  it("queries with an RLS client built from the caller's token", async () => {
    const { repo, supabaseService } = makeRepository(
      chain({ data: [], error: null }),
    );

    await repo.findAllForUser(user);

    expect(supabaseService.forUser).toHaveBeenCalledWith(user.token);
  });

  it("maps rows to contract items and filters by the token user id", async () => {
    const listChain = chain({ data: [ROW], error: null });
    const { repo } = makeRepository(listChain);

    const items = await repo.findAllForUser(user);

    expect(listChain.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(items).toEqual([
      {
        widgetId: "clock",
        gridPos: { x: 0, y: 0, w: 2, h: 1 },
        settings: { hour12: true },
      },
    ]);
  });

  it("surfaces query errors as 500s, not client errors", async () => {
    const { repo } = makeRepository(
      chain({ data: null, error: { message: "boom" } }),
    );

    await expect(repo.findAllForUser(user)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("surfaces corrupt stored rows as 500s (never ZodErrors)", async () => {
    const { repo } = makeRepository(
      chain({
        data: [{ widget_id: "clock", grid_pos: { bad: true }, settings: {} }],
        error: null,
      }),
    );

    await expect(repo.findAllForUser(user)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("replaces the layout with delete-then-insert scoped to the user", async () => {
    const deleteChain = chain({ error: null });
    const insertChain = chain({ error: null });
    const { repo } = makeRepository(deleteChain, insertChain);

    await repo.replaceForUser(user, [
      { widgetId: "clock", gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} },
    ]);

    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(insertChain.insert).toHaveBeenCalledWith([
      {
        user_id: user.id,
        widget_id: "clock",
        grid_pos: { x: 0, y: 0, w: 2, h: 1 },
        settings: {},
      },
    ]);
  });

  it("skips the insert when replacing with an empty layout", async () => {
    const deleteChain = chain({ error: null });
    const { repo, from } = makeRepository(deleteChain);

    await repo.replaceForUser(user, []);

    expect(from).toHaveBeenCalledTimes(1);
  });

  it("fails the replace when the delete step errors", async () => {
    const { repo } = makeRepository(chain({ error: { message: "nope" } }));

    await expect(
      repo.replaceForUser(user, [
        { widgetId: "clock", gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} },
      ]),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

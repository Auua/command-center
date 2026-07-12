import { InternalServerErrorException } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { SupabaseService } from "../supabase/supabase.service";
import { TasksRepository } from "./tasks.repository";

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
  error: { message: string; code?: string } | null;
}): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "order",
    "delete",
    "insert",
    "update",
    "single",
    "maybeSingle",
  ]) {
    c[method] = jest.fn(() => c);
  }
  c.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown> => Promise.resolve(result).then(resolve, reject);
  return c;
}

function makeRepository(...chains: ReturnType<typeof chain>[]): {
  repo: TasksRepository;
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
  return { repo: new TasksRepository(supabaseService), from, supabaseService };
}

const ROW = {
  id: "9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f",
  title: "Review ARD feedback notes",
  priority: 1,
  tags: ["work"],
  deadline: "2026-07-11",
  completed_at: null,
  created_at: "2026-07-11T10:00:00.123456+00:00",
  updated_at: "2026-07-11T10:00:00.123456+00:00",
};

describe("TasksRepository", () => {
  it("queries with an RLS client built from the caller's token", async () => {
    const { repo, supabaseService } = makeRepository(
      chain({ data: [], error: null }),
    );

    await repo.listForUser(user);

    expect(supabaseService.forUser).toHaveBeenCalledWith(user.token);
  });

  it("maps rows to the contract, normalizing PostgREST timestamps", async () => {
    const listChain = chain({ data: [ROW], error: null });
    const { repo } = makeRepository(listChain);

    const items = await repo.listForUser(user);

    expect(listChain.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(items).toEqual([
      {
        id: ROW.id,
        title: ROW.title,
        priority: 1,
        tags: ["work"],
        deadline: "2026-07-11",
        completedAt: null,
        createdAt: "2026-07-11T10:00:00.123Z",
        updatedAt: "2026-07-11T10:00:00.123Z",
      },
    ]);
  });

  it("surfaces query errors as 500s, not client errors", async () => {
    const { repo } = makeRepository(
      chain({ data: null, error: { message: "boom" } }),
    );

    await expect(repo.listForUser(user)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("surfaces corrupt stored rows as 500s (never ZodErrors)", async () => {
    const { repo } = makeRepository(
      chain({ data: [{ ...ROW, priority: 9 }], error: null }),
    );

    await expect(repo.listForUser(user)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("inserts with the token user id, never a body-supplied one", async () => {
    const insertChain = chain({ data: ROW, error: null });
    const { repo } = makeRepository(insertChain);

    await repo.createForUser(user, {
      title: ROW.title,
      priority: 1,
      tags: ["work"],
      deadline: "2026-07-11",
    });

    expect(insertChain.insert).toHaveBeenCalledWith({
      user_id: user.id,
      title: ROW.title,
      priority: 1,
      tags: ["work"],
      deadline: "2026-07-11",
    });
  });

  it("updates scoped to both user id and task id", async () => {
    const updateChain = chain({ data: ROW, error: null });
    const { repo } = makeRepository(updateChain);

    const task = await repo.updateForUser(user, ROW.id, { title: "renamed" });

    expect(updateChain.update).toHaveBeenCalledWith({ title: "renamed" });
    expect(updateChain.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(updateChain.eq).toHaveBeenCalledWith("id", ROW.id);
    expect(task?.id).toBe(ROW.id);
  });

  it("returns null/false for unmatched and malformed-uuid ids", async () => {
    const { repo } = makeRepository(
      chain({ data: null, error: null }),
      chain({ data: null, error: { message: "bad uuid", code: "22P02" } }),
      chain({ data: null, error: null }),
      chain({ data: null, error: { message: "bad uuid", code: "22P02" } }),
    );

    await expect(repo.updateForUser(user, "missing", {})).resolves.toBeNull();
    await expect(repo.updateForUser(user, "not-a-uuid", {})).resolves.toBeNull();
    await expect(repo.deleteForUser(user, "missing")).resolves.toBe(false);
    await expect(repo.deleteForUser(user, "not-a-uuid")).resolves.toBe(false);
  });

  it("deletes scoped to the user and reports whether a row matched", async () => {
    const deleteChain = chain({ data: { id: ROW.id }, error: null });
    const { repo } = makeRepository(deleteChain);

    await expect(repo.deleteForUser(user, ROW.id)).resolves.toBe(true);
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(deleteChain.eq).toHaveBeenCalledWith("id", ROW.id);
  });
});

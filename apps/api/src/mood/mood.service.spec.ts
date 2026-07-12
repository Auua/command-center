import { NotFoundException } from "@nestjs/common";
import type { MoodCheckin } from "@command-center/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { MoodRepository } from "./mood.repository";
import { MoodService } from "./mood.service";

const user: AuthenticatedUser = {
  id: "00000000-0000-0000-0000-000000000001",
  token: "jwt",
};

const CHECKIN: MoodCheckin = {
  id: "6f2d38a0-9a1e-4a0e-8f2a-000000000001",
  score: 4,
  tags: ["focused"],
  note: null,
  createdAt: "2026-07-12T08:30:00.000Z",
};

describe("MoodService", () => {
  let repository: jest.Mocked<
    Pick<MoodRepository, "listSinceForUser" | "createForUser" | "deleteForUser">
  >;
  let service: MoodService;

  beforeEach(() => {
    repository = {
      listSinceForUser: jest.fn(),
      createForUser: jest.fn(),
      deleteForUser: jest.fn(),
    };
    service = new MoodService(repository as unknown as MoodRepository);
  });

  it("lists check-ins from a timestamp `days` back from now", async () => {
    repository.listSinceForUser.mockResolvedValue([CHECKIN]);
    const before = Date.now();

    await expect(service.listCheckins(user, 7)).resolves.toEqual({
      items: [CHECKIN],
    });

    const since = repository.listSinceForUser.mock.calls[0]?.[1] ?? "";
    const sinceMs = Date.parse(since);
    const expected = before - 7 * 86_400_000;
    // The window is computed from the clock at call time; allow a little slack.
    expect(Math.abs(sinceMs - expected)).toBeLessThan(5_000);
  });

  it("maps the contract's score onto the mood_score column", async () => {
    repository.createForUser.mockResolvedValue(CHECKIN);

    await service.createCheckin(user, {
      score: 4,
      tags: ["focused"],
      note: null,
    });

    expect(repository.createForUser).toHaveBeenCalledWith(user, {
      mood_score: 4,
      tags: ["focused"],
      note: null,
    });
  });

  it("404s a delete that matched no owned row", async () => {
    repository.deleteForUser.mockResolvedValue(false);

    await expect(service.deleteCheckin(user, "some-id")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("resolves silently when the delete matched", async () => {
    repository.deleteForUser.mockResolvedValue(true);

    await expect(service.deleteCheckin(user, CHECKIN.id)).resolves.toBeUndefined();
  });
});

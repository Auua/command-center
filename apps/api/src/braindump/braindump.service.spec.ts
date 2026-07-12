import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  BraindumpListResponseSchema,
  BraindumpNoteSchema,
  type BraindumpNote,
} from "@command-center/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { BraindumpRepository } from "./braindump.repository";
import { BraindumpService } from "./braindump.service";

const user: AuthenticatedUser = {
  id: "00000000-0000-0000-0000-000000000001",
  token: "jwt",
};

function makeNote(overrides: Partial<BraindumpNote> = {}): BraindumpNote {
  return {
    id: "665f1e1e1e1e1e1e1e1e1e1e",
    content: "remember the milk",
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    ...overrides,
  };
}

describe("BraindumpService", () => {
  let service: BraindumpService;
  let repository: jest.Mocked<
    Pick<
      BraindumpRepository,
      "listForUser" | "createForUser" | "updateContentForUser" | "deleteForUser"
    >
  >;

  beforeEach(async () => {
    repository = {
      listForUser: jest.fn(),
      createForUser: jest.fn(),
      updateContentForUser: jest.fn(),
      deleteForUser: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BraindumpService,
        { provide: BraindumpRepository, useValue: repository },
      ],
    }).compile();

    service = moduleRef.get(BraindumpService);
  });

  it("lists the user's notes as a contract-shaped response", async () => {
    const note = makeNote();
    repository.listForUser.mockResolvedValue([note]);

    const result = await service.listNotes(user);

    expect(() => BraindumpListResponseSchema.parse(result)).not.toThrow();
    expect(result.items).toEqual([note]);
    expect(repository.listForUser).toHaveBeenCalledWith(user.id);
  });

  it("creates a note scoped to the token's user id", async () => {
    const note = makeNote();
    repository.createForUser.mockResolvedValue(note);

    const result = await service.createNote(user, { content: note.content });

    expect(() => BraindumpNoteSchema.parse(result)).not.toThrow();
    expect(repository.createForUser).toHaveBeenCalledWith(
      user.id,
      note.content,
    );
  });

  it("updates a note and returns the new contract shape", async () => {
    const note = makeNote({ content: "updated" });
    repository.updateContentForUser.mockResolvedValue(note);

    const result = await service.updateNote(user, note.id, {
      content: "updated",
    });

    expect(result).toEqual(note);
    expect(repository.updateContentForUser).toHaveBeenCalledWith(
      user.id,
      note.id,
      "updated",
    );
  });

  it("404s on update when the note is missing, foreign, or the id is malformed", async () => {
    repository.updateContentForUser.mockResolvedValue(null);

    await expect(
      service.updateNote(user, "not-an-objectid", { content: "x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("deletes a note owned by the user", async () => {
    repository.deleteForUser.mockResolvedValue(true);

    await expect(
      service.deleteNote(user, makeNote().id),
    ).resolves.toBeUndefined();
    expect(repository.deleteForUser).toHaveBeenCalledWith(
      user.id,
      makeNote().id,
    );
  });

  it("404s on delete when nothing owned by the user matched", async () => {
    repository.deleteForUser.mockResolvedValue(false);

    await expect(
      service.deleteNote(user, makeNote().id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

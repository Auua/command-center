import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { ZodError } from "zod";
import type { AuthenticatedUser } from "../auth/auth.types";
import { BraindumpController } from "./braindump.controller";
import { BraindumpService } from "./braindump.service";

const user: AuthenticatedUser = {
  id: "00000000-0000-0000-0000-000000000001",
  token: "jwt",
};

describe("BraindumpController", () => {
  let controller: BraindumpController;
  let service: jest.Mocked<
    Pick<BraindumpService, "listNotes" | "createNote" | "updateNote" | "deleteNote">
  >;

  beforeEach(async () => {
    service = {
      listNotes: jest.fn(),
      createNote: jest.fn(),
      updateNote: jest.fn(),
      deleteNote: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BraindumpController],
      providers: [{ provide: BraindumpService, useValue: service }],
    }).compile();

    controller = moduleRef.get(BraindumpController);
  });

  it("delegates list to the service with the token user", async () => {
    service.listNotes.mockResolvedValue({ items: [] });

    await expect(controller.listNotes(user)).resolves.toEqual({ items: [] });
    expect(service.listNotes).toHaveBeenCalledWith(user);
  });

  it("parses and trims create requests before delegating", async () => {
    await controller.createNote(user, { content: "  keep me  " });

    expect(service.createNote).toHaveBeenCalledWith(user, {
      content: "keep me",
    });
  });

  it("rejects unknown top-level fields on create (reject-unknown-fields)", () => {
    expect(() =>
      controller.createNote(user, { content: "x", userId: "someone-else" }),
    ).toThrow(ZodError);
    expect(service.createNote).not.toHaveBeenCalled();
  });

  it("rejects empty and whitespace-only content", () => {
    expect(() => controller.createNote(user, { content: "" })).toThrow(ZodError);
    expect(() => controller.createNote(user, { content: "   " })).toThrow(ZodError);
  });

  it("rejects a missing body", () => {
    expect(() => controller.createNote(user, undefined)).toThrow(ZodError);
  });

  it("parses update requests and passes the id through", async () => {
    await controller.updateNote(user, "abc123", { content: "new" });

    expect(service.updateNote).toHaveBeenCalledWith(user, "abc123", {
      content: "new",
    });
  });

  it("rejects unknown fields on update", () => {
    expect(() =>
      controller.updateNote(user, "abc123", { content: "x", extra: 1 }),
    ).toThrow(ZodError);
  });

  it("delegates delete to the service", async () => {
    await controller.deleteNote(user, "abc123");
    expect(service.deleteNote).toHaveBeenCalledWith(user, "abc123");
  });
});

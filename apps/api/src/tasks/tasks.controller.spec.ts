import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { ZodError } from "zod";
import type { AuthenticatedUser } from "../auth/auth.types";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

const user: AuthenticatedUser = {
  id: "00000000-0000-0000-0000-000000000001",
  token: "jwt",
};

describe("TasksController", () => {
  let controller: TasksController;
  let service: jest.Mocked<
    Pick<TasksService, "listTasks" | "createTask" | "updateTask" | "deleteTask">
  >;

  beforeEach(async () => {
    service = {
      listTasks: jest.fn(),
      createTask: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [{ provide: TasksService, useValue: service }],
    }).compile();

    controller = moduleRef.get(TasksController);
  });

  it("delegates list to the service with the token user", async () => {
    service.listTasks.mockResolvedValue({ items: [] });

    await expect(controller.listTasks(user)).resolves.toEqual({ items: [] });
    expect(service.listTasks).toHaveBeenCalledWith(user);
  });

  it("parses create requests, trimming and filling defaults", async () => {
    await controller.createTask(user, { title: "  pay rent  " });

    expect(service.createTask).toHaveBeenCalledWith(user, {
      title: "pay rent",
      priority: null,
      tags: [],
      deadline: null,
    });
  });

  it("rejects unknown top-level fields on create (reject-unknown-fields)", () => {
    expect(() =>
      controller.createTask(user, { title: "x", userId: "someone-else" }),
    ).toThrow(ZodError);
    expect(service.createTask).not.toHaveBeenCalled();
  });

  it("rejects a missing body and an invalid priority", () => {
    expect(() => controller.createTask(user, undefined)).toThrow(ZodError);
    expect(() =>
      controller.createTask(user, { title: "x", priority: 9 }),
    ).toThrow(ZodError);
  });

  it("parses partial updates and passes the id through", async () => {
    await controller.updateTask(user, "abc123", { completed: true });

    expect(service.updateTask).toHaveBeenCalledWith(user, "abc123", {
      completed: true,
    });
  });

  it("rejects empty and unknown-field updates", () => {
    expect(() => controller.updateTask(user, "abc123", {})).toThrow(ZodError);
    expect(() =>
      controller.updateTask(user, "abc123", { completed: true, extra: 1 }),
    ).toThrow(ZodError);
    expect(service.updateTask).not.toHaveBeenCalled();
  });

  it("delegates delete to the service", async () => {
    await controller.deleteTask(user, "abc123");
    expect(service.deleteTask).toHaveBeenCalledWith(user, "abc123");
  });
});

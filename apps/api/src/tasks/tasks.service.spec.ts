import { NotFoundException } from "@nestjs/common";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { Task } from "@command-center/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { TASK_COMPLETED_EVENT } from "./task-completed.event";
import type { TasksRepository } from "./tasks.repository";
import { TasksService } from "./tasks.service";

const user: AuthenticatedUser = {
  id: "00000000-0000-0000-0000-000000000001",
  token: "jwt",
};

const TASK: Task = {
  id: "9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f",
  title: "Review ARD feedback notes",
  priority: 1,
  tags: [],
  deadline: null,
  completedAt: null,
  createdAt: "2026-07-11T10:00:00.000Z",
  updatedAt: "2026-07-11T10:00:00.000Z",
};

describe("TasksService", () => {
  let repository: jest.Mocked<
    Pick<
      TasksRepository,
      "listForUser" | "createForUser" | "updateForUser" | "deleteForUser"
    >
  >;
  let eventEmitter: { emit: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    repository = {
      listForUser: jest.fn(),
      createForUser: jest.fn(),
      updateForUser: jest.fn(),
      deleteForUser: jest.fn(),
    };
    eventEmitter = { emit: jest.fn() };
    service = new TasksService(
      repository as unknown as TasksRepository,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  it("wraps the repository list in the response envelope", async () => {
    repository.listForUser.mockResolvedValue([TASK]);

    await expect(service.listTasks(user)).resolves.toEqual({ items: [TASK] });
  });

  it("sets completed_at from the clock, never from the client", async () => {
    repository.updateForUser.mockResolvedValue({
      ...TASK,
      completedAt: "2026-07-11T12:00:00.000Z",
    });

    await service.updateTask(user, TASK.id, { completed: true });

    expect(repository.updateForUser).toHaveBeenCalledWith(user, TASK.id, {
      completed_at: expect.any(String),
    });
    const patch = repository.updateForUser.mock.calls[0]?.[2];
    expect(Date.parse(patch?.completed_at ?? "")).not.toBeNaN();
  });

  it("clears completed_at when un-completing", async () => {
    repository.updateForUser.mockResolvedValue(TASK);

    await service.updateTask(user, TASK.id, { completed: false });

    expect(repository.updateForUser).toHaveBeenCalledWith(user, TASK.id, {
      completed_at: null,
    });
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("emits task.completed when a task is completed", async () => {
    repository.updateForUser.mockResolvedValue({
      ...TASK,
      completedAt: "2026-07-11T12:00:00.000Z",
    });

    await service.updateTask(user, TASK.id, { completed: true });

    expect(eventEmitter.emit).toHaveBeenCalledWith(TASK_COMPLETED_EVENT, {
      userId: user.id,
      taskId: TASK.id,
      title: TASK.title,
      completedAt: "2026-07-11T12:00:00.000Z",
    });
  });

  it("does not emit task.completed for non-completion updates", async () => {
    repository.updateForUser.mockResolvedValue(TASK);

    await service.updateTask(user, TASK.id, { title: "renamed" });

    expect(repository.updateForUser).toHaveBeenCalledWith(user, TASK.id, {
      title: "renamed",
    });
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("404s updates and deletes of missing/foreign tasks alike", async () => {
    repository.updateForUser.mockResolvedValue(null);
    repository.deleteForUser.mockResolvedValue(false);

    await expect(
      service.updateTask(user, "nope", { completed: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteTask(user, "nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});

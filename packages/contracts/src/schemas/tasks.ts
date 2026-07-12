import { z } from "zod";

/**
 * Task — todo item with optional priority, tags, and deadline (ARD §4.4:
 * relational, lives in Postgres `tasks`, owned by TasksModule). Priority is
 * 1 (highest) to 3; absent means unprioritized. Deadline is a plain calendar
 * date — tasks are day-granular, not scheduled to the minute.
 */
export const TASK_PRIORITIES = [1, 2, 3] as const;

export const TaskPrioritySchema = z
  .union([z.literal(1), z.literal(2), z.literal(3)])
  .nullable();

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  priority: TaskPrioritySchema,
  tags: z.array(z.string().min(1)),
  deadline: z.string().date().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskListResponseSchema = z.object({
  items: z.array(TaskSchema),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

const TitleSchema = z.string().trim().min(1).max(500);
const TagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(20)
  .transform((tags) => [...new Set(tags)]);

/**
 * Write-path schemas reject unknown top-level fields here in the contract
 * (ARD §5.2 reject-unknown-fields): the update schema's `.refine` wrapper
 * means the API controller couldn't bolt `.strict()` on afterwards.
 */
export const CreateTaskRequestSchema = z
  .object({
    title: TitleSchema,
    priority: TaskPrioritySchema.default(null),
    tags: TagsSchema.default([]),
    deadline: z.string().date().nullable().default(null),
  })
  .strict();
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

/**
 * Partial update; `completed` maps to setting/clearing `completed_at`
 * server-side so completion time is never client-supplied.
 */
export const UpdateTaskRequestSchema = z
  .object({
    title: TitleSchema,
    priority: TaskPrioritySchema,
    tags: TagsSchema,
    deadline: z.string().date().nullable(),
    completed: z.boolean(),
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Update must change at least one field",
  });
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

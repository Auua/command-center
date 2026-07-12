import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  type Task,
  type TaskListResponse,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TasksService } from './tasks.service';

/**
 * /api/v1/tasks — tasks CRUD (ARD §4.1 TasksModule). Validation is explicit
 * zod `.parse` (ZodErrors become 400s via the global ZodExceptionFilter);
 * unknown-field rejection is baked into the task write schemas themselves.
 * The user always comes from the verified JWT.
 */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  listTasks(@CurrentUser() user: AuthenticatedUser): Promise<TaskListResponse> {
    return this.tasksService.listTasks(user);
  }

  @Post()
  createTask(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<Task> {
    const request = CreateTaskRequestSchema.parse(body);
    return this.tasksService.createTask(user, request);
  }

  @Patch(':id')
  updateTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Task> {
    const request = UpdateTaskRequestSchema.parse(body);
    return this.tasksService.updateTask(user, id, request);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTask(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.tasksService.deleteTask(user, id);
  }
}

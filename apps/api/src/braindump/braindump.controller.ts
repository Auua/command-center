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
} from "@nestjs/common";
import {
  CreateBraindumpNoteRequestSchema,
  UpdateBraindumpNoteRequestSchema,
  type BraindumpListResponse,
  type BraindumpNote,
} from "@command-center/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { BraindumpService } from "./braindump.service";

/**
 * Reject unknown top-level fields on write paths (ARD §5.2
 * reject-unknown-fields).
 */
const CreateStrictSchema = CreateBraindumpNoteRequestSchema.strict();
const UpdateStrictSchema = UpdateBraindumpNoteRequestSchema.strict();

/**
 * /api/v1/braindump — braindump notes CRUD (ARD §4.1 BraindumpModule).
 * Validation is explicit zod `.parse` (ZodErrors become 400s via the global
 * ZodExceptionFilter); the user always comes from the verified JWT.
 */
@Controller("braindump")
export class BraindumpController {
  constructor(private readonly braindumpService: BraindumpService) {}

  @Get()
  listNotes(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BraindumpListResponse> {
    return this.braindumpService.listNotes(user);
  }

  @Post()
  createNote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<BraindumpNote> {
    const request = CreateStrictSchema.parse(body);
    return this.braindumpService.createNote(user, request);
  }

  @Patch(":id")
  updateNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<BraindumpNote> {
    const request = UpdateStrictSchema.parse(body);
    return this.braindumpService.updateNote(user, id, request);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.braindumpService.deleteNote(user, id);
  }
}

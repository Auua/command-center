import type { ArgumentsHost } from "@nestjs/common";
import { z, ZodError } from "zod";
import { ZodExceptionFilter } from "./zod-exception.filter";

function makeHost(): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const host = {
    switchToHttp: (): { getResponse: () => typeof response } => ({
      getResponse: (): typeof response => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function capture(schema: z.ZodTypeAny, value: unknown): ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("expected a validation failure");
  return result.error;
}

describe("ZodExceptionFilter", () => {
  it("maps ZodErrors to a 400 with a structured issue list", () => {
    const { host, status, json } = makeHost();
    const error = capture(
      z.object({ content: z.string().min(1) }).strict(),
      { content: "", extra: true },
    );

    new ZodExceptionFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      error: "Bad Request",
      message: "Validation failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "content", code: "too_small" }),
        expect.objectContaining({ code: "unrecognized_keys" }),
      ]),
    });
  });

  it("joins nested paths with dots", () => {
    const { host, json } = makeHost();
    const error = capture(
      z.object({ items: z.array(z.object({ id: z.string() })) }),
      { items: [{ id: 1 }] },
    );

    new ZodExceptionFilter().catch(error, host);

    const body = json.mock.calls[0]?.[0] as { issues: { path: string }[] };
    expect(body.issues[0]?.path).toBe("items.0.id");
  });
});

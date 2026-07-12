import { describe, expect, it } from "vitest";
import {
  BraindumpListResponseSchema,
  BraindumpNoteSchema,
  CreateBraindumpNoteRequestSchema,
  UpdateBraindumpNoteRequestSchema,
} from "./braindump";

const NOTE = {
  id: "665f1e1e1e1e1e1e1e1e1e1e",
  content: "a thought",
  createdAt: "2026-07-11T10:00:00.000Z",
  updatedAt: "2026-07-11T10:05:00.000Z",
};

describe("BraindumpNoteSchema", () => {
  it("accepts a well-formed note", () => {
    expect(BraindumpNoteSchema.parse(NOTE)).toEqual(NOTE);
  });

  it.each([
    ["empty id", { ...NOTE, id: "" }],
    ["non-ISO createdAt", { ...NOTE, createdAt: "yesterday" }],
    ["missing updatedAt", { ...NOTE, updatedAt: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(BraindumpNoteSchema.safeParse(value).success).toBe(false);
  });
});

describe("BraindumpListResponseSchema", () => {
  it("accepts empty and populated lists", () => {
    expect(BraindumpListResponseSchema.parse({ items: [] }).items).toEqual([]);
    expect(
      BraindumpListResponseSchema.parse({ items: [NOTE] }).items,
    ).toHaveLength(1);
  });
});

describe.each([
  ["CreateBraindumpNoteRequestSchema", CreateBraindumpNoteRequestSchema],
  ["UpdateBraindumpNoteRequestSchema", UpdateBraindumpNoteRequestSchema],
])("%s", (_name, schema) => {
  it("trims surrounding whitespace", () => {
    expect(schema.parse({ content: "  hello  " })).toEqual({
      content: "hello",
    });
  });

  it("rejects empty and whitespace-only content", () => {
    expect(schema.safeParse({ content: "" }).success).toBe(false);
    expect(schema.safeParse({ content: "   " }).success).toBe(false);
  });

  it("rejects content above the 20k cap", () => {
    expect(schema.safeParse({ content: "x".repeat(20_001) }).success).toBe(
      false,
    );
    expect(schema.safeParse({ content: "x".repeat(20_000) }).success).toBe(
      true,
    );
  });

  it("preserves inner newlines (braindumps are multi-line)", () => {
    expect(schema.parse({ content: "line one\nline two" }).content).toBe(
      "line one\nline two",
    );
  });
});

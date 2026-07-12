import { describe, expect, it } from "vitest";
import {
  CreateMoodCheckinRequestSchema,
  MoodCheckinSchema,
  MoodWindowDaysSchema,
} from "./mood";

const VALID_CHECKIN = {
  id: "6f2d38a0-9a1e-4a0e-8f2a-000000000001",
  score: 4,
  tags: ["focused"],
  note: null,
  createdAt: "2026-07-12T08:30:00.000Z",
};

describe("MoodCheckinSchema", () => {
  it("accepts a valid check-in", () => {
    expect(MoodCheckinSchema.parse(VALID_CHECKIN)).toEqual(VALID_CHECKIN);
  });

  it("rejects out-of-range scores", () => {
    expect(MoodCheckinSchema.safeParse({ ...VALID_CHECKIN, score: 0 }).success).toBe(false);
    expect(MoodCheckinSchema.safeParse({ ...VALID_CHECKIN, score: 6 }).success).toBe(false);
    expect(MoodCheckinSchema.safeParse({ ...VALID_CHECKIN, score: 3.5 }).success).toBe(false);
  });
});

describe("CreateMoodCheckinRequestSchema", () => {
  it("fills defaults for tags and note", () => {
    expect(CreateMoodCheckinRequestSchema.parse({ score: 3 })).toEqual({
      score: 3,
      tags: [],
      note: null,
    });
  });

  it("trims and dedupes tags", () => {
    const parsed = CreateMoodCheckinRequestSchema.parse({
      score: 5,
      tags: [" focused ", "focused", "tired"],
    });
    expect(parsed.tags).toEqual(["focused", "tired"]);
  });

  it("rejects unknown top-level fields (reject-unknown-fields)", () => {
    const result = CreateMoodCheckinRequestSchema.safeParse({
      score: 3,
      userId: "someone-else",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing or invalid score", () => {
    expect(CreateMoodCheckinRequestSchema.safeParse({}).success).toBe(false);
    expect(CreateMoodCheckinRequestSchema.safeParse({ score: 9 }).success).toBe(false);
  });

  it("rejects an empty or oversized note", () => {
    expect(
      CreateMoodCheckinRequestSchema.safeParse({ score: 3, note: "   " }).success,
    ).toBe(false);
    expect(
      CreateMoodCheckinRequestSchema.safeParse({ score: 3, note: "x".repeat(1001) })
        .success,
    ).toBe(false);
  });
});

describe("MoodWindowDaysSchema", () => {
  it("defaults to 7 and coerces strings", () => {
    expect(MoodWindowDaysSchema.parse(undefined)).toBe(7);
    expect(MoodWindowDaysSchema.parse("14")).toBe(14);
  });

  it("rejects non-numeric, fractional, and out-of-range windows", () => {
    expect(MoodWindowDaysSchema.safeParse("abc").success).toBe(false);
    expect(MoodWindowDaysSchema.safeParse("2.5").success).toBe(false);
    expect(MoodWindowDaysSchema.safeParse("0").success).toBe(false);
    expect(MoodWindowDaysSchema.safeParse("91").success).toBe(false);
  });
});

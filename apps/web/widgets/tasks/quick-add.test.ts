import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add";

// Friday 10 July 2026 — a fixed local date so weekday math is deterministic.
const now = new Date(2026, 6, 10, 12, 0, 0);

describe("parseQuickAdd", () => {
  it("treats plain input as a bare title", () => {
    expect(parseQuickAdd("buy milk", now)).toEqual({
      title: "buy milk",
      priority: null,
      tags: [],
      deadline: null,
    });
  });

  it('parses the mock\'s hinted syntax "pay rent friday p1"', () => {
    // "friday" typed on a Friday means the *next* Friday.
    expect(parseQuickAdd("pay rent friday p1", now)).toEqual({
      title: "pay rent",
      priority: 1,
      tags: [],
      deadline: "2026-07-17",
    });
  });

  it("resolves 'today' and 'tomorrow'", () => {
    expect(parseQuickAdd("water plants today", now).deadline).toBe(
      "2026-07-10",
    );
    expect(parseQuickAdd("water plants tomorrow", now).deadline).toBe(
      "2026-07-11",
    );
  });

  it("accepts a leading day token", () => {
    expect(parseQuickAdd("tomorrow buy bread", now)).toEqual({
      title: "buy bread",
      priority: null,
      tags: [],
      deadline: "2026-07-11",
    });
  });

  it("resolves weekday abbreviations to the next occurrence", () => {
    // Next Monday after Friday 10 July is 13 July.
    expect(parseQuickAdd("meet sam mon", now).deadline).toBe("2026-07-13");
    // Sunday wraps within the same weekend.
    expect(parseQuickAdd("call mum sunday", now).deadline).toBe("2026-07-12");
  });

  it("extracts #tags anywhere and dedupes them", () => {
    expect(parseQuickAdd("#home email accountant tomorrow p2 #home", now)).toEqual({
      title: "email accountant",
      priority: 2,
      tags: ["home"],
      deadline: "2026-07-11",
    });
  });

  it("is case-insensitive for day and priority tokens", () => {
    expect(parseQuickAdd("PAY RENT FRIDAY P1", now)).toEqual({
      title: "PAY RENT",
      priority: 1,
      tags: [],
      deadline: "2026-07-17",
    });
  });

  it("leaves mid-title tokens alone", () => {
    expect(parseQuickAdd("buy p1 paint", now)).toEqual({
      title: "buy p1 paint",
      priority: null,
      tags: [],
      deadline: null,
    });
    expect(parseQuickAdd("call monday about rates", now)).toEqual({
      title: "call monday about rates",
      priority: null,
      tags: [],
      deadline: null,
    });
  });

  it("does not treat a bare '#' as a tag", () => {
    expect(parseQuickAdd("push # to remote", now)).toEqual({
      title: "push # to remote",
      priority: null,
      tags: [],
      deadline: null,
    });
  });

  it("returns an empty title when input is only metadata tokens", () => {
    expect(parseQuickAdd("p1", now).title).toBe("");
    expect(parseQuickAdd("#work today p2", now).title).toBe("");
    expect(parseQuickAdd("   ", now).title).toBe("");
  });
});

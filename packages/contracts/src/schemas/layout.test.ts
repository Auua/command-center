import { describe, expect, it } from "vitest";
import {
  GridPosSchema,
  PutLayoutRequestSchema,
  WidgetLayoutItemSchema,
} from "./layout";

describe("GridPosSchema", () => {
  it("accepts a valid grid position", () => {
    expect(
      GridPosSchema.parse({ x: 0, y: 0, w: 2, h: 1 }),
    ).toEqual({ x: 0, y: 0, w: 2, h: 1 });
  });

  it.each([
    ["negative origin", { x: -1, y: 0, w: 1, h: 1 }],
    ["zero width", { x: 0, y: 0, w: 0, h: 1 }],
    ["fractional cell", { x: 0.5, y: 0, w: 1, h: 1 }],
  ])("rejects %s", (_label, value) => {
    expect(GridPosSchema.safeParse(value).success).toBe(false);
  });
});

describe("WidgetLayoutItemSchema", () => {
  it("defaults settings to an empty object", () => {
    const item = WidgetLayoutItemSchema.parse({
      widgetId: "clock",
      gridPos: { x: 0, y: 0, w: 2, h: 1 },
    });
    expect(item.settings).toEqual({});
  });

  it("rejects an empty widget id", () => {
    expect(
      WidgetLayoutItemSchema.safeParse({
        widgetId: "",
        gridPos: { x: 0, y: 0, w: 1, h: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("PutLayoutRequestSchema", () => {
  it("accepts an empty layout (user removed every widget)", () => {
    expect(PutLayoutRequestSchema.parse({ items: [] }).items).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { WidgetRegistry } from "@command-center/ui";
import { clockWidgetDefinition } from "./clock";
import { widgetRegistry } from "./registry";

describe("widgetRegistry", () => {
  it("has the phase-1 widgets registered", () => {
    expect(widgetRegistry.get("clock")).toBeDefined();
    expect(widgetRegistry.get("braindump")).toBeDefined();
    expect(widgetRegistry.get("mood")).toBeDefined();
    expect(widgetRegistry.get("tasks")).toBeDefined();
  });

  it("returns undefined for unregistered ids (grid shows a fallback card)", () => {
    expect(widgetRegistry.get("does-not-exist")).toBeUndefined();
  });

  it("exposes every registered definition via all()", () => {
    const ids = widgetRegistry.all().map((definition) => definition.id);
    expect(ids).toEqual(
      expect.arrayContaining(["clock", "braindump", "mood", "tasks"]),
    );
  });
});

describe("WidgetRegistry", () => {
  it("rejects duplicate widget ids", () => {
    const registry = new WidgetRegistry();
    registry.register(clockWidgetDefinition);
    expect(() => registry.register(clockWidgetDefinition)).toThrow(
      /already registered/,
    );
  });
});

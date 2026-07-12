import type { WidgetDefinition } from './widget';

// Settings types are heterogeneous across widgets; the registry stores them
// erased and each widget's component/schema pair stays internally consistent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWidgetDefinition = WidgetDefinition<any>;

export class WidgetRegistry {
  private readonly widgets = new Map<string, AnyWidgetDefinition>();

  register<TSettings>(definition: WidgetDefinition<TSettings>): void {
    if (this.widgets.has(definition.id)) {
      throw new Error(`Widget "${definition.id}" is already registered`);
    }
    this.widgets.set(definition.id, definition);
  }

  get(id: string): AnyWidgetDefinition | undefined {
    return this.widgets.get(id);
  }

  all(): AnyWidgetDefinition[] {
    return [...this.widgets.values()];
  }
}

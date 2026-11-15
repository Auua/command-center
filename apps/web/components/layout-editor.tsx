'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';
import type { WidgetLayoutItem } from '@command-center/contracts';
import {
  CheckIcon,
  clampToDeclaredSize,
  DismissButton,
  ErrorText,
  Hint,
  moveItem,
  orderOfLayout,
  packLayout,
  PencilIcon,
  PlusIcon,
  type AnyWidgetDefinition,
  type WidgetSize,
} from '@command-center/ui';
import { t } from '@/lib/i18n';
import { DEFAULT_LAYOUT } from '@/widgets/default-layout';
import { widgetRegistry } from '@/widgets/registry';

/**
 * Layout editor (ADR-042): the order is the layout. Every editor action is a
 * list operation followed by `packLayout`; the draft is written with one
 * PUT /layout on Done and discarded on Cancel.
 */

/** Stable identity of a placement: definition + instance (ADR-013). */
export function placementKey(item: WidgetLayoutItem): string {
  return `${item.widgetId}:${item.instanceKey}`;
}

function titleOf(widgetId: string): string {
  return widgetRegistry.get(widgetId)?.title ?? widgetId;
}

/**
 * A stored layout as an ordered list: reading order of its (possibly
 * hand-placed) coordinates, each registered widget snapped to a declared
 * size. Packing it — at whatever column count — gives the cards' cells.
 */
export function inLayoutOrder(items: readonly WidgetLayoutItem[]): WidgetLayoutItem[] {
  return orderOfLayout(items).map((item) => {
    const definition = widgetRegistry.get(item.widgetId);
    if (!definition) return item;
    const size = clampToDeclaredSize({ w: item.gridPos.w, h: item.gridPos.h }, definition.sizes);
    return { ...item, gridPos: { ...item.gridPos, w: size.w, h: size.h } };
  });
}

/** The draft a stored layout opens as: in order, packed at the reference width. */
function toDraft(items: readonly WidgetLayoutItem[]): WidgetLayoutItem[] {
  return packLayout(inLayoutOrder(items));
}

interface DraftState {
  /** What the editor opened with, already packed — Done compares against it. */
  baseline: WidgetLayoutItem[];
  draft: WidgetLayoutItem[];
}

export interface LayoutDraft {
  editing: boolean;
  /** The packed draft in the user's order; null outside edit mode. */
  draft: WidgetLayoutItem[] | null;
  /** True when Done has something to write. */
  dirty: boolean;
  /** Registry definitions with no placement in the draft (the picker's list). */
  unplaced: AnyWidgetDefinition[];
  /** Attach to the grid: focus moves to a card's editor bar after add/remove. */
  gridRef: RefObject<HTMLDivElement | null>;
  start: (items: readonly WidgetLayoutItem[]) => void;
  move: (index: number, delta: -1 | 1) => void;
  resize: (index: number, size: WidgetSize) => void;
  remove: (index: number) => void;
  add: (definition: AnyWidgetDefinition) => void;
  reset: () => void;
  /** Leave edit mode, dropping the draft (Cancel, or after a successful save). */
  stop: () => void;
}

/**
 * Draft state of the layout editor. Each operation re-packs immediately and
 * reports what happened through `announce` (the polite live region).
 */
export function useLayoutDraft(announce: (message: string) => void): LayoutDraft {
  const [state, setState] = useState<DraftState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // A placement whose editor bar should take focus after the next commit —
  // used when the control that was pressed leaves the DOM (remove, add).
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const bars = gridRef.current?.querySelectorAll<HTMLElement>('[data-placement]') ?? [];
    for (const bar of bars) {
      if (bar.dataset.placement === key) {
        bar.focus();
        break;
      }
    }
  });

  const draft = state?.draft ?? null;

  const update = (next: WidgetLayoutItem[]): void => {
    setState((current) => (current ? { ...current, draft: packLayout(next) } : current));
  };

  const start = (items: readonly WidgetLayoutItem[]): void => {
    const baseline = toDraft(items);
    setState({ baseline, draft: baseline });
    announce(t('layout.announce.editing'));
  };

  const move = (index: number, delta: -1 | 1): void => {
    if (!draft) return;
    const target = index + delta;
    const item = draft[index];
    if (!item || target < 0 || target >= draft.length) return;
    update(moveItem(draft, index, target));
    announce(
      t('layout.announce.moved', {
        title: titleOf(item.widgetId),
        position: target + 1,
        count: draft.length,
      }),
    );
  };

  const resize = (index: number, size: WidgetSize): void => {
    const item = draft?.[index];
    if (!draft || !item) return;
    update(
      draft.map((entry, i) =>
        i === index ? { ...entry, gridPos: { ...entry.gridPos, w: size.w, h: size.h } } : entry,
      ),
    );
    announce(t('layout.announce.resized', { title: titleOf(item.widgetId), w: size.w, h: size.h }));
  };

  const remove = (index: number): void => {
    const item = draft?.[index];
    // The last widget stays: an empty saved layout reads as "never saved".
    if (!draft || !item || draft.length <= 1) return;
    const next = draft.filter((_, i) => i !== index);
    const neighbour = next[Math.min(index, next.length - 1)];
    pendingFocus.current = neighbour ? placementKey(neighbour) : null;
    update(next);
    announce(t('layout.announce.removed', { title: titleOf(item.widgetId) }));
  };

  const add = (definition: AnyWidgetDefinition): void => {
    if (!draft) return;
    const size = definition.sizes[0] ?? { w: 2, h: 2 };
    const item: WidgetLayoutItem = {
      widgetId: definition.id,
      instanceKey: '',
      gridPos: { x: 0, y: 0, w: size.w, h: size.h },
      settings: { ...(definition.defaultSettings as Record<string, unknown>) },
    };
    pendingFocus.current = placementKey(item);
    update([...draft, item]);
    announce(
      t('layout.announce.added', {
        title: definition.title,
        position: draft.length + 1,
        count: draft.length + 1,
      }),
    );
  };

  const reset = (): void => {
    update(DEFAULT_LAYOUT);
    announce(t('layout.announce.reset'));
  };

  const stop = (): void => setState(null);

  const placed = new Set(draft?.map((item) => item.widgetId) ?? []);
  const unplaced = widgetRegistry
    .all()
    .filter((definition) => !placed.has(definition.id))
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    editing: state !== null,
    draft,
    dirty: state !== null && JSON.stringify(state.draft) !== JSON.stringify(state.baseline),
    unplaced,
    gridRef,
    start,
    move,
    resize,
    remove,
    add,
    reset,
    stop,
  };
}

// ---- Toolbar ----

interface LayoutToolbarProps {
  editing: boolean;
  saving: boolean;
  error: string | null;
  onEdit: () => void;
  onAdd: () => void;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
}

/**
 * "Edit layout" outside edit mode; Add widget / Reset to default / Cancel /
 * Done inside it. The button that was pressed disappears on every switch,
 * so focus moves to the first button of the other set.
 */
export function LayoutToolbar({
  editing,
  saving,
  error,
  onEdit,
  onAdd,
  onReset,
  onCancel,
  onDone,
}: LayoutToolbarProps): ReactElement {
  const editRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);

  useEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    (editing ? addRef : editRef).current?.focus();
  }, [editing]);

  return (
    <div className="cc-layout-toolbar">
      <div className="cc-layout-toolbar-buttons" role="group" aria-label={t('layout.toolbar')}>
        {editing ? (
          <>
            <button
              ref={addRef}
              type="button"
              className="cc-btn cc-btn-ghost cc-btn-sm"
              aria-haspopup="dialog"
              disabled={saving}
              onClick={onAdd}
            >
              <span aria-hidden="true">
                <PlusIcon size={13} />
              </span>
              {t('layout.add')}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-ghost cc-btn-sm"
              disabled={saving}
              onClick={onReset}
            >
              {t('layout.reset')}
            </button>
            <span className="cc-layout-toolbar-spacer" />
            {/* Cancel and Done wrap as a pair on narrow screens. */}
            <span className="cc-layout-toolbar-commit">
              <button
                type="button"
                className="cc-btn cc-btn-ghost cc-btn-sm"
                disabled={saving}
                onClick={onCancel}
              >
                {t('layout.cancel')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn-sm"
                disabled={saving}
                aria-busy={saving || undefined}
                onClick={onDone}
              >
                <span aria-hidden="true">
                  <CheckIcon size={13} />
                </span>
                {saving ? t('layout.saving') : t('layout.done')}
              </button>
            </span>
          </>
        ) : (
          <button
            ref={editRef}
            type="button"
            className="cc-btn cc-btn-ghost cc-btn-sm"
            onClick={onEdit}
          >
            <span aria-hidden="true">
              <PencilIcon size={13} />
            </span>
            {t('layout.edit')}
          </button>
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

// ---- Per-card editor bar ----

function ChevronIcon({ direction }: { direction: 'earlier' | 'later' }): ReactElement {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={direction === 'earlier' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
    </svg>
  );
}

const sizeValue = (size: WidgetSize): string => `${size.w}x${size.h}`;

interface LayoutItemBarProps {
  item: WidgetLayoutItem;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onResize: (size: WidgetSize) => void;
  onRemove: () => void;
}

/**
 * Move earlier / move later / size / remove for one card. Unavailable
 * actions are `aria-disabled` rather than `disabled`, so a button that just
 * moved its card to the end keeps focus (a disabled button would drop it).
 */
export function LayoutItemBar({
  item,
  index,
  count,
  onMove,
  onResize,
  onRemove,
}: LayoutItemBarProps): ReactElement {
  const definition = widgetRegistry.get(item.widgetId);
  const title = definition?.title ?? item.widgetId;
  const sizes = definition?.sizes ?? [];
  const isFirst = index === 0;
  const isLast = index === count - 1;
  const isOnly = count <= 1;
  const removeLabel = t('layout.item.remove', { title });

  return (
    <div
      className="cc-layout-bar"
      role="group"
      aria-label={t('layout.item.group', { title })}
      tabIndex={-1}
      data-placement={placementKey(item)}
    >
      <span className="cc-layout-bar-position">
        {t('layout.item.position', { position: index + 1, count })}
      </span>
      <button
        type="button"
        className="cc-btn cc-btn-ghost cc-btn-sm cc-layout-icon-btn cc-layout-move"
        aria-label={t('layout.item.moveEarlier', { title })}
        title={t('layout.item.moveEarlier', { title })}
        aria-disabled={isFirst || undefined}
        onClick={() => {
          if (!isFirst) onMove(-1);
        }}
      >
        <ChevronIcon direction="earlier" />
      </button>
      <button
        type="button"
        className="cc-btn cc-btn-ghost cc-btn-sm cc-layout-icon-btn cc-layout-move"
        aria-label={t('layout.item.moveLater', { title })}
        title={t('layout.item.moveLater', { title })}
        aria-disabled={isLast || undefined}
        onClick={() => {
          if (!isLast) onMove(1);
        }}
      >
        <ChevronIcon direction="later" />
      </button>
      {sizes.length > 1 && (
        <select
          className="cc-layout-size"
          aria-label={t('layout.item.size', { title })}
          value={sizeValue(item.gridPos)}
          onChange={(event) => {
            const next = sizes.find((size) => sizeValue(size) === event.target.value);
            if (next) onResize(next);
          }}
        >
          {sizes.map((size) => (
            <option key={sizeValue(size)} value={sizeValue(size)}>
              {t('layout.item.sizeOption', { w: size.w, h: size.h })}
            </option>
          ))}
        </select>
      )}
      <DismissButton
        className="cc-layout-remove"
        label={removeLabel}
        title={isOnly ? t('layout.item.removeLast') : removeLabel}
        aria-disabled={isOnly || undefined}
        onClick={() => {
          if (!isOnly) onRemove();
        }}
      />
    </div>
  );
}

// ---- Add-widget picker ----

interface AddWidgetDialogProps {
  /** Definitions with no placement yet; empty → the dialog says so. */
  definitions: AnyWidgetDefinition[];
  onPick: (definition: AnyWidgetDefinition) => void;
  onClose: () => void;
}

/** Native `<dialog>` (the settings panel's pattern) listing unplaced widgets. */
export function AddWidgetDialog({
  definitions,
  onPick,
  onClose,
}: AddWidgetDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="cc-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="cc-dialog-title">
        {t('layout.picker.title')}
      </h2>
      <div className="cc-dialog-body">
        {definitions.length === 0 ? (
          <Hint>{t('layout.picker.empty')}</Hint>
        ) : (
          <>
            <Hint>{t('layout.picker.hint')}</Hint>
            <ul className="cc-layout-picker">
              {definitions.map((definition) => (
                <li key={definition.id}>
                  <button
                    type="button"
                    className="cc-layout-picker-option"
                    style={
                      definition.accent
                        ? ({ '--cc-wc': definition.accent } as CSSProperties)
                        : undefined
                    }
                    onClick={() => onPick(definition)}
                  >
                    <span className="cc-widget-chip" aria-hidden="true">
                      {definition.icon}
                    </span>
                    <span>{definition.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="cc-dialog-footer">
        <span className="cc-dialog-footer-spacer" />
        <button type="button" className="cc-btn cc-btn-ghost" onClick={onClose}>
          {t('layout.picker.close')}
        </button>
      </div>
    </dialog>
  );
}

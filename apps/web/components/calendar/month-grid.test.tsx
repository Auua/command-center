import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarOccurrence } from '@command-center/contracts';
import { MonthGrid, type MonthGridProps } from './month-grid';

const occurrence = (title: string, date: string): CalendarOccurrence => ({
  seriesId: '7d3c0a8e-5a8a-4c1b-9d3e-1f2a3b4c5d6e',
  occurrenceStart: date,
  isRecurring: false,
  title,
  location: null,
  note: null,
  allDay: true,
  startsOn: date,
  endsOn: date,
});

function Harness(
  props: Partial<MonthGridProps> & { start?: string; onMove?: (date: string) => void },
): ReactElement {
  const [focused, setFocused] = useState(props.start ?? '2026-07-14');
  return (
    <MonthGrid
      focused={focused}
      today="2026-07-16"
      weekStartsOn={1}
      byDay={props.byDay ?? new Map()}
      tasksByDay={new Map()}
      zone="Europe/Helsinki"
      onFocusChange={(date) => {
        props.onMove?.(date);
        setFocused(date);
      }}
      onOpenDay={props.onOpenDay ?? vi.fn()}
      onQuickCreate={props.onQuickCreate ?? vi.fn()}
    />
  );
}

const cell = (name: RegExp): HTMLElement => screen.getByRole('gridcell', { name });

describe('MonthGrid', () => {
  it('is a labelled grid with localised weekday headers, Monday first', () => {
    render(<Harness />);
    const grid = screen.getByRole('grid', { name: 'July 2026' });
    const headers = within(grid).getAllByRole('columnheader');
    expect(headers.map((h) => h.getAttribute('aria-label'))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(grid).toHaveAttribute('aria-colcount', '7');
  });

  it('names each cell with the date and its event count, and marks today', () => {
    const byDay = new Map([
      ['2026-07-14', [occurrence('Birthday', '2026-07-14'), occurrence('Dinner', '2026-07-14')]],
      ['2026-07-15', [occurrence('Dentist', '2026-07-15')]],
    ]);
    render(<Harness byDay={byDay} />);
    expect(cell(/^Tuesday 14 July, 2 events$/)).toBeInTheDocument();
    expect(cell(/^Wednesday 15 July, 1 event$/)).toBeInTheDocument();
    expect(cell(/^Thursday 16 July, no events$/)).toHaveAttribute('aria-current', 'date');
  });

  it('has exactly one tab stop, on the focused day', () => {
    render(<Harness />);
    const tabbable = screen.getAllByRole('gridcell').filter((c) => c.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName(/^Tuesday 14 July/);
  });

  it('moves by day, week, week end and month — into the next month too', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const start = cell(/^Tuesday 14 July/);
    start.focus();

    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(cell(/^Wednesday 15 July/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(cell(/^Wednesday 22 July/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(cell(/^Sunday 26 July/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(cell(/^Monday 20 July/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'PageDown' });
    expect(screen.getByRole('grid', { name: 'August 2026' })).toBeInTheDocument();
    expect(cell(/^Thursday 20 August/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'PageUp', shiftKey: true });
    expect(cell(/^Wednesday, 20 August 2025/)).toHaveFocus();
    expect(onMove).toHaveBeenLastCalledWith('2025-08-20');
  });

  it('opens the day on Enter, and starts a new event when typing on it', () => {
    const onOpenDay = vi.fn();
    const onQuickCreate = vi.fn();
    render(<Harness onOpenDay={onOpenDay} onQuickCreate={onQuickCreate} />);
    const start = cell(/^Tuesday 14 July/);
    fireEvent.keyDown(start, { key: 'Enter' });
    expect(onOpenDay).toHaveBeenCalledWith('2026-07-14');
    fireEvent.keyDown(start, { key: 'L' });
    expect(onQuickCreate).toHaveBeenCalledWith('2026-07-14', 'L');
    fireEvent.keyDown(start, { key: 'c', ctrlKey: true });
    expect(onQuickCreate).toHaveBeenCalledTimes(1);
  });

  it('keeps days outside the month as real, muted cells', () => {
    render(<Harness />);
    // July 2026 starts on a Wednesday: Monday 29 June leads the grid.
    expect(cell(/^Monday 29 June/)).toHaveAttribute('data-outside', 'true');
  });
});

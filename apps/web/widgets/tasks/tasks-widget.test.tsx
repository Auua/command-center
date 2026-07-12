import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@command-center/contracts';
import { TasksWidget } from './tasks-widget';

vi.mock('@/lib/tasks-api', () => ({
  fetchTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));

import { createTask, deleteTask, fetchTasks, updateTask } from '@/lib/tasks-api';

const fetchMock = vi.mocked(fetchTasks);
const createMock = vi.mocked(createTask);
const updateMock = vi.mocked(updateTask);
const deleteMock = vi.mocked(deleteTask);

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '6f9c2d1e-0000-4000-8000-000000000001',
    title: 'Review ARD feedback notes',
    priority: 1,
    tags: [],
    deadline: null,
    completedAt: null,
    createdAt: '2026-07-10T09:00:00.000Z',
    updatedAt: '2026-07-10T09:00:00.000Z',
    ...overrides,
  };
}

function renderWithQuery(ui: ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TasksWidget', () => {
  it('renders open tasks with their priority pill', async () => {
    fetchMock.mockResolvedValue({ items: [task()] });

    renderWithQuery(<TasksWidget />);

    expect(await screen.findByText('Review ARD feedback notes')).toBeInTheDocument();
    expect(screen.getByText('P1')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: 'Mark "Review ARD feedback notes" complete',
      }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('renders due labels as time elements and tags as text', async () => {
    fetchMock.mockResolvedValue({
      items: [task({ deadline: '2020-01-01', tags: ['home'] })],
    });

    renderWithQuery(<TasksWidget />);

    // A 2020 deadline is long past — the label must literally say overdue.
    const due = await screen.findByText(/overdue/i);
    expect(due.tagName).toBe('TIME');
    expect(due).toHaveAttribute('datetime', '2020-01-01');
    expect(screen.getByText('#home')).toBeInTheDocument();
  });

  it("marks completed tasks checked, struck through, and 'done'", async () => {
    fetchMock.mockResolvedValue({
      items: [task({ completedAt: '2026-07-10T10:00:00.000Z' })],
    });

    renderWithQuery(<TasksWidget />);

    const toggle = await screen.findByRole('checkbox', {
      name: 'Mark "Review ARD feedback notes" incomplete',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('Review ARD feedback notes').closest('li')).toHaveClass('done');
  });

  it('shows an empty state when there are no tasks', async () => {
    fetchMock.mockResolvedValue({ items: [] });

    renderWithQuery(<TasksWidget />);

    expect(await screen.findByText(/nothing on the list/i)).toBeInTheDocument();
  });

  it('shows an error state when loading fails (widget failure posture)', async () => {
    fetchMock.mockRejectedValue(new Error('API down'));

    renderWithQuery(<TasksWidget />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load tasks/i);
  });

  it('quick-adds with parsed priority and tags, then clears the input', async () => {
    fetchMock.mockResolvedValue({ items: [] });
    createMock.mockResolvedValue(task({ title: 'pay rent' }));
    const user = userEvent.setup();

    renderWithQuery(<TasksWidget />);
    const input = await screen.findByLabelText(/quick add task/i);
    await user.type(input, 'pay rent p1 #home{Enter}');

    // TanStack Query passes a context object as the mutationFn's 2nd arg.
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        { title: 'pay rent', priority: 1, tags: ['home'], deadline: null },
        expect.anything(),
      ),
    );
    expect(input).toHaveValue('');
  });

  it('does not submit drafts that parse to an empty title', async () => {
    fetchMock.mockResolvedValue({ items: [] });
    const user = userEvent.setup();

    renderWithQuery(<TasksWidget />);
    const input = await screen.findByLabelText(/quick add task/i);
    await user.type(input, 'p1{Enter}');
    await user.type(input, '   {Enter}');

    expect(createMock).not.toHaveBeenCalled();
  });

  it('completes an open task via its toggle', async () => {
    fetchMock.mockResolvedValue({ items: [task()] });
    updateMock.mockResolvedValue(task({ completedAt: '2026-07-10T10:00:00.000Z' }));
    const user = userEvent.setup();

    renderWithQuery(<TasksWidget />);
    await user.click(await screen.findByRole('checkbox', { name: /mark .* complete/i }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('6f9c2d1e-0000-4000-8000-000000000001', {
        completed: true,
      }),
    );
  });

  it('reopens a completed task via its toggle', async () => {
    fetchMock.mockResolvedValue({
      items: [task({ completedAt: '2026-07-10T10:00:00.000Z' })],
    });
    updateMock.mockResolvedValue(task());
    const user = userEvent.setup();

    renderWithQuery(<TasksWidget />);
    await user.click(await screen.findByRole('checkbox', { name: /mark .* incomplete/i }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('6f9c2d1e-0000-4000-8000-000000000001', {
        completed: false,
      }),
    );
  });

  it('deletes a task via its delete button', async () => {
    fetchMock.mockResolvedValue({ items: [task()] });
    deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithQuery(<TasksWidget />);
    await user.click(await screen.findByRole('button', { name: /delete task/i }));

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        '6f9c2d1e-0000-4000-8000-000000000001',
        expect.anything(),
      ),
    );
  });

  it('surfaces a save error without losing the list', async () => {
    fetchMock.mockResolvedValue({ items: [task()] });
    createMock.mockRejectedValue(new Error('500'));
    const user = userEvent.setup();

    renderWithQuery(<TasksWidget />);
    const input = await screen.findByLabelText(/quick add task/i);
    await user.type(input, 'doomed{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save/i);
    expect(screen.getByText('Review ARD feedback notes')).toBeInTheDocument();
  });
});

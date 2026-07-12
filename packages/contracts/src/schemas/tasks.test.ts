import { describe, expect, it } from 'vitest';
import {
  CreateTaskRequestSchema,
  TaskListResponseSchema,
  TaskSchema,
  UpdateTaskRequestSchema,
} from './tasks';

const TASK = {
  id: '9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f',
  title: 'Review ARD feedback notes',
  priority: 1,
  tags: ['work'],
  deadline: '2026-07-11',
  completedAt: null,
  createdAt: '2026-07-11T10:00:00.000Z',
  updatedAt: '2026-07-11T10:05:00.000Z',
};

describe('TaskSchema', () => {
  it('accepts a well-formed task', () => {
    expect(TaskSchema.parse(TASK)).toEqual(TASK);
  });

  it('accepts a completed, unprioritized, deadline-free task', () => {
    const done = {
      ...TASK,
      priority: null,
      tags: [],
      deadline: null,
      completedAt: '2026-07-11T12:00:00.000Z',
    };
    expect(TaskSchema.parse(done)).toEqual(done);
  });

  it.each([
    ['non-uuid id', { ...TASK, id: '42' }],
    ['empty title', { ...TASK, title: '' }],
    ['priority 0', { ...TASK, priority: 0 }],
    ['priority 4', { ...TASK, priority: 4 }],
    ['datetime deadline', { ...TASK, deadline: '2026-07-11T10:00:00.000Z' }],
    ['non-ISO createdAt', { ...TASK, createdAt: 'yesterday' }],
    ['missing completedAt', { ...TASK, completedAt: undefined }],
  ])('rejects %s', (_label, value) => {
    expect(TaskSchema.safeParse(value).success).toBe(false);
  });
});

describe('TaskListResponseSchema', () => {
  it('accepts empty and populated lists', () => {
    expect(TaskListResponseSchema.parse({ items: [] }).items).toEqual([]);
    expect(TaskListResponseSchema.parse({ items: [TASK] }).items).toHaveLength(1);
  });
});

describe('CreateTaskRequestSchema', () => {
  it('fills optional fields with defaults', () => {
    expect(CreateTaskRequestSchema.parse({ title: 'pay rent' })).toEqual({
      title: 'pay rent',
      priority: null,
      tags: [],
      deadline: null,
    });
  });

  it('trims the title and rejects empty/whitespace-only titles', () => {
    expect(CreateTaskRequestSchema.parse({ title: '  pay rent  ' }).title).toBe('pay rent');
    expect(CreateTaskRequestSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('rejects titles above the 500-char cap', () => {
    expect(CreateTaskRequestSchema.safeParse({ title: 'x'.repeat(501) }).success).toBe(false);
    expect(CreateTaskRequestSchema.safeParse({ title: 'x'.repeat(500) }).success).toBe(true);
  });

  it('dedupes tags and rejects empty tags', () => {
    expect(CreateTaskRequestSchema.parse({ title: 't', tags: ['a', 'a', 'b'] }).tags).toEqual([
      'a',
      'b',
    ]);
    expect(CreateTaskRequestSchema.safeParse({ title: 't', tags: [' '] }).success).toBe(false);
  });
});

describe('UpdateTaskRequestSchema', () => {
  it('accepts single-field updates', () => {
    expect(UpdateTaskRequestSchema.parse({ completed: true })).toEqual({
      completed: true,
    });
    expect(UpdateTaskRequestSchema.parse({ priority: null })).toEqual({
      priority: null,
    });
  });

  it('rejects an empty update', () => {
    expect(UpdateTaskRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown top-level fields (write paths are strict)', () => {
    expect(UpdateTaskRequestSchema.safeParse({ completed: true, admin: true }).success).toBe(false);
    expect(CreateTaskRequestSchema.safeParse({ title: 't', userId: 'someone-else' }).success).toBe(
      false,
    );
  });

  it('rejects invalid field values just like create', () => {
    expect(UpdateTaskRequestSchema.safeParse({ title: '' }).success).toBe(false);
    expect(UpdateTaskRequestSchema.safeParse({ priority: 5 }).success).toBe(false);
    expect(UpdateTaskRequestSchema.safeParse({ deadline: 'next tuesday' }).success).toBe(false);
  });
});

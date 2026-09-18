'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { StreaksResponse } from '@command-center/contracts';
import { fetchStreaks } from '@/lib/learning-api';

export const STREAKS_QUERY_KEY = ['streaks'];

/**
 * Shared streaks read (ADR-014): the streaks widget and the learning cards'
 * streak pills all hang off this one query, so a "Learned it" invalidates
 * one key and every pill updates.
 */
export function useStreaks(): UseQueryResult<StreaksResponse> {
  return useQuery({
    queryKey: STREAKS_QUERY_KEY,
    queryFn: fetchStreaks,
    staleTime: 60_000,
  });
}

import { ProfileSchema, type Profile, type UpdateProfileRequest } from '@command-center/contracts';
import { ApiError, apiFetch } from '@/lib/api';

/** Client for /api/v1/profile (ProfileModule). */

/** Returns null when no profile row exists yet (404) — the D4 signal. */
export async function fetchProfile(): Promise<Profile | null> {
  try {
    const response = await apiFetch('/api/v1/profile');
    return ProfileSchema.parse(await response.json());
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function updateProfile(request: UpdateProfileRequest): Promise<Profile> {
  const response = await apiFetch('/api/v1/profile', {
    method: 'PUT',
    body: request,
  });
  return ProfileSchema.parse(await response.json());
}

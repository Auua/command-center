import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import {
  VaultClient,
  VaultConflictError,
  VaultNotFoundError,
  VaultTokenInvalidError,
  VaultUnavailableError,
  type FetchLike,
  type FetchResponse,
} from './vault.client';

function config(values: Partial<Env>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FetchResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string): string | null => lower[name.toLowerCase()] ?? null },
    json: (): Promise<unknown> => Promise.resolve(body),
  };
}

const CONFIGURED = { GITHUB_LEARNING_REPO: 'auua/learning-center', GITHUB_LEARNING_TOKEN: 'ghp_x' };

describe('VaultClient', () => {
  it('reports unconfigured without the env pair and refuses to call GitHub', async () => {
    const fetchMock = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
    const client = new VaultClient(config({}), fetchMock);

    expect(client.configured).toBe(false);
    await expect(client.headSha()).rejects.toBeInstanceOf(VaultUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds note URLs with per-segment encoding', () => {
    const client = new VaultClient(config(CONFIGURED));
    expect(client.noteUrl('Japanese/30 Sanasto/Sanat/～目 (jarjestysluku).md')).toBe(
      'https://github.com/auua/learning-center/blob/main/Japanese/30%20Sanasto/Sanat/%EF%BD%9E%E7%9B%AE%20(jarjestysluku).md',
    );
  });

  it('reads the head sha and decodes base64 file content at a ref', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(jsonResponse(200, { commit: { sha: 'abc123' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: Buffer.from('hello ～目', 'utf8').toString('base64'),
          sha: 'blob1',
          encoding: 'base64',
        }),
      );
    const client = new VaultClient(config(CONFIGURED), fetchMock);

    await expect(client.headSha()).resolves.toBe('abc123');
    await expect(client.getFile('.cc/index/manifest.json', 'abc123')).resolves.toEqual({
      content: 'hello ～目',
      sha: 'blob1',
    });

    const [url, init] = fetchMock.mock.calls[1] ?? ['', undefined];
    expect(url).toBe(
      'https://api.github.com/repos/auua/learning-center/contents/.cc/index/manifest.json?ref=abc123',
    );
    expect(init?.headers?.Authorization).toBe('Bearer ghp_x');
  });

  it('writes with the sha guard and the bot committer', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(jsonResponse(200, { content: { sha: 'blob2' } }));
    const client = new VaultClient(config(CONFIGURED), fetchMock);

    await expect(client.putFile('.cc/state.json', '{}', 'blob1', 'cc: wotd pin')).resolves.toBe(
      'blob2',
    );
    const [, init] = fetchMock.mock.calls[0] ?? ['', undefined];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(init?.method).toBe('PUT');
    expect(body.sha).toBe('blob1');
    expect(body.branch).toBe('main');
    expect(body.message).toBe('cc: wotd pin');
    expect((body.committer as { name: string }).name).toBe('command-center[bot]');
    expect(Buffer.from(String(body.content), 'base64').toString('utf8')).toBe('{}');
  });

  it('omits the sha when creating a file', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(jsonResponse(201, { content: { sha: 'new' } }));
    const client = new VaultClient(config(CONFIGURED), fetchMock);

    await client.putFile('.cc/state.json', '{}', null, 'cc: create');
    const [, init] = fetchMock.mock.calls[0] ?? ['', undefined];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('sha');
  });

  it.each([
    [401, VaultTokenInvalidError],
    [403, VaultTokenInvalidError],
    [404, VaultNotFoundError],
    [409, VaultConflictError],
    [422, VaultConflictError],
    [502, VaultUnavailableError],
  ])('maps HTTP %s to %p', async (status, errorClass) => {
    const fetchMock = jest
      .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(jsonResponse(status, { message: 'nope' }));
    const client = new VaultClient(config(CONFIGURED), fetchMock);

    await expect(client.getFile('x.md')).rejects.toBeInstanceOf(errorClass);
  });

  it('treats a 403 rate-limit as an outage, not a dead token', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(jsonResponse(403, {}, { 'x-ratelimit-remaining': '0' }));
    const client = new VaultClient(config(CONFIGURED), fetchMock);

    await expect(client.getFile('x.md')).rejects.toBeInstanceOf(VaultUnavailableError);
  });

  it('returns null from getFileOrNull on 404 and wraps network failures', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const client = new VaultClient(config(CONFIGURED), fetchMock);

    await expect(client.getFileOrNull('.cc/state.json')).resolves.toBeNull();
    await expect(client.getFileOrNull('.cc/state.json')).rejects.toBeInstanceOf(
      VaultUnavailableError,
    );
  });
});

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isLearningConfigured, type Env } from '../../config/env';

/**
 * GitHub Contents API client for the learning-center vault (ADR-024): plain
 * `fetch`, four calls, no Octokit. Reads pin to a commit sha; writes carry
 * the file's sha guard and a fixed bot author so `git log` separates app
 * writes from `obsidian-git` backups (ADR-040).
 *
 * Errors are typed so the services can tell a dead credential (never hidden
 * behind serve-stale) from an outage (served stale) from a lost write race
 * (refetch + reapply).
 */

export class VaultTokenInvalidError extends Error {
  constructor() {
    super('Vault token rejected by GitHub (expired or revoked PAT)');
    this.name = 'VaultTokenInvalidError';
  }
}

export class VaultNotFoundError extends Error {
  constructor(path: string) {
    super(`Vault file not found: ${path}`);
    this.name = 'VaultNotFoundError';
  }
}

export class VaultConflictError extends Error {
  constructor(path: string) {
    super(`Vault file changed underneath the write: ${path}`);
    this.name = 'VaultConflictError';
  }
}

export class VaultUnavailableError extends Error {
  constructor(detail: string) {
    super(`Vault unavailable: ${detail}`);
    this.name = 'VaultUnavailableError';
  }
}

export interface VaultFile {
  content: string;
  sha: string;
}

/** Injection token for the fetch implementation (overridden in tests). */
export const VAULT_FETCH = Symbol('VAULT_FETCH');

/**
 * Structural fetch types: the sliver of the WHATWG API this client uses.
 * Declared here rather than relying on the global `Response`/`RequestInit`
 * so the build does not depend on which lib set the toolchain resolves
 * (Vercel's nestjs preset saw a `Response` without `json()`).
 */
export interface FetchInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponse>;

const defaultFetch: FetchLike = (input, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(input, init);

const BRANCH = 'main';
const COMMITTER = {
  name: 'command-center[bot]',
  email: 'command-center[bot]@users.noreply.github.com',
};

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

@Injectable()
export class VaultClient {
  private readonly logger = new Logger(VaultClient.name);
  readonly configured: boolean;
  readonly repo: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    configService: ConfigService<Env, true>,
    @Optional() @Inject(VAULT_FETCH) fetchImpl?: FetchLike,
  ) {
    // ConfigService falls back to raw process.env for keys the validator
    // dropped, so a blank value can reach here — treat it as unset too.
    const repo = configService.get('GITHUB_LEARNING_REPO', { infer: true }) || undefined;
    const token = configService.get('GITHUB_LEARNING_TOKEN', { infer: true }) || undefined;
    this.configured = isLearningConfigured({
      GITHUB_LEARNING_REPO: repo,
      GITHUB_LEARNING_TOKEN: token,
    });
    this.repo = repo ?? '';
    this.token = token ?? '';
    this.fetchImpl = fetchImpl ?? defaultFetch;
  }

  /** github.com URL of the repo (about panel, vault-status). */
  get repoUrl(): string {
    return `https://github.com/${this.repo}`;
  }

  /** github.com URL of a note on main. */
  noteUrl(path: string): string {
    return `${this.repoUrl}/blob/${BRANCH}/${encodePath(path)}`;
  }

  /** Current head commit sha of main. */
  async headSha(): Promise<string> {
    const response = await this.request(`branches/${BRANCH}`);
    const body = (await response.json()) as { commit?: { sha?: string } };
    const sha = body.commit?.sha;
    if (!sha) throw new VaultUnavailableError('branch response without a commit sha');
    return sha;
  }

  /** Fetch a file (≤ 1 MB) at a ref; content decoded from base64. */
  async getFile(path: string, ref?: string): Promise<VaultFile> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const response = await this.request(`contents/${encodePath(path)}${query}`, undefined, path);
    const body = (await response.json()) as { content?: string; sha?: string; encoding?: string };
    if (typeof body.content !== 'string' || typeof body.sha !== 'string') {
      throw new VaultUnavailableError(`unexpected contents response for ${path}`);
    }
    if (body.encoding !== 'base64') {
      throw new VaultUnavailableError(`unexpected encoding ${body.encoding ?? 'none'} for ${path}`);
    }
    return { content: Buffer.from(body.content, 'base64').toString('utf8'), sha: body.sha };
  }

  /** Like getFile but null on 404 (a state file that does not exist yet). */
  async getFileOrNull(path: string, ref?: string): Promise<VaultFile | null> {
    try {
      return await this.getFile(path, ref);
    } catch (error) {
      if (error instanceof VaultNotFoundError) return null;
      throw error;
    }
  }

  /**
   * Create (sha null) or update (sha guard) a file on main. Returns the new
   * blob sha. A guard mismatch surfaces as VaultConflictError.
   */
  async putFile(
    path: string,
    content: string,
    sha: string | null,
    message: string,
  ): Promise<string> {
    const response = await this.request(
      `contents/${encodePath(path)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message,
          content: Buffer.from(content, 'utf8').toString('base64'),
          branch: BRANCH,
          committer: COMMITTER,
          author: COMMITTER,
          ...(sha ? { sha } : {}),
        }),
      },
      path,
    );
    const body = (await response.json()) as { content?: { sha?: string } };
    const newSha = body.content?.sha;
    if (!newSha) throw new VaultUnavailableError(`write response without a sha for ${path}`);
    return newSha;
  }

  private async request(route: string, init?: FetchInit, path = route): Promise<FetchResponse> {
    if (!this.configured) throw new VaultUnavailableError('learning vault is not configured');
    const url = `https://api.github.com/repos/${this.repo}/${route}`;
    let response: FetchResponse;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch (error) {
      throw new VaultUnavailableError(error instanceof Error ? error.message : String(error));
    }

    if (response.ok) return response;

    const status = response.status;
    if (
      status === 401 ||
      (status === 403 && response.headers.get('x-ratelimit-remaining') !== '0')
    ) {
      this.logger.warn(`GitHub rejected the vault token (${status}) on ${path}`);
      throw new VaultTokenInvalidError();
    }
    if (status === 404) throw new VaultNotFoundError(path);
    if (status === 409 || status === 422) throw new VaultConflictError(path);
    throw new VaultUnavailableError(`GitHub responded ${status} on ${path}`);
  }
}

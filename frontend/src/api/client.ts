// One place that talks HTTP to the backend. Every response uses the envelope
//   { success: true, data, meta? }   or   { success: false, error: { code, message, details?, requestId } }
// Screens branch on ApiError.code, never on the message.

import { apiUrl, type QueryValue } from './url';
import { getSession, refreshSession, setSession } from './session';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;
  /** Seconds to wait, from Retry-After on 429 responses. */
  readonly retryAfter: number | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | null;
    retryAfter?: number | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
    this.retryAfter = init.retryAfter ?? null;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** 'none' never sends the token (auth endpoints); otherwise it is sent when signed in. */
  auth?: 'none' | 'send';
  signal?: AbortSignal;
}

export interface ApiResult<T, M = unknown> {
  data: T;
  meta: M;
}

export async function request<T, M = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResult<T, M>> {
  const session = options.auth === 'none' ? null : getSession();
  const first = await send(path, options, session?.accessToken);

  if (first.status === 401 && session) {
    const code = await peekCode(first);
    if (code === 'TOKEN_EXPIRED') {
      const renewed = await refreshSession(session.accessToken);
      if (renewed) return parse<T, M>(await send(path, options, renewed.accessToken));
      // Session over: retry without a token (public endpoints still work), else surface 401.
      return parse<T, M>(await send(path, options, undefined));
    }
    if (code === 'INVALID_TOKEN' || code === 'UNAUTHORIZED') {
      // The stored token is unusable (e.g. secret rotated, account disabled): sign out locally.
      setSession(null);
      return parse<T, M>(await send(path, options, undefined));
    }
  }
  return parse<T, M>(first);
}

async function send(path: string, options: RequestOptions, accessToken: string | undefined): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(apiUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the Navora server. Check that the backend is running.',
    });
  }
}

async function peekCode(response: Response): Promise<string | undefined> {
  const body = await response.clone().json().catch(() => null);
  return body?.error?.code;
}

async function parse<T, M>(response: Response): Promise<ApiResult<T, M>> {
  const requestId = response.headers.get('X-Request-Id');
  const body = await response.json().catch(() => null);

  if (response.ok && body?.success) {
    return { data: body.data as T, meta: body.meta as M };
  }

  const retryAfterHeader = response.headers.get('Retry-After');
  const error = body?.error;
  throw new ApiError({
    status: response.status,
    code: error?.code ?? (response.status >= 500 ? 'INTERNAL_ERROR' : 'UNEXPECTED_RESPONSE'),
    message: error?.message ?? `Unexpected response (${response.status})`,
    details: error?.details,
    requestId: error?.requestId ?? requestId,
    retryAfter: retryAfterHeader ? Number(retryAfterHeader) : null,
  });
}

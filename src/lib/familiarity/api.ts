import type { OverrideState, ParseResponse } from './types';

/**
 * Same-origin client for the learning backend. The reverse proxy authenticates the user (Authelia
 * cookie); an expired session answers with a redirect to the login page, which we surface as a warning
 * instead of throwing inside the reader.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    redirect: 'manual'
  });
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
    throw new ApiError(
      'Not signed in to the reader backend — reload the page to sign in again',
      401
    );
  }
  if (!res.ok) throw new ApiError(`backend error ${res.status}`, res.status);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new ApiError('unexpected response from backend', 502);
  return (await res.json()) as T;
}

export const familiarityApi = {
  parse: (blocks: { key: string; text: string }[]) =>
    post<ParseResponse>('/api/jiten/parse', { blocks }),
  refresh: () => post<{ refreshed: number }>('/api/jiten/refresh', {}),
  setOverride: (w: number, r: number, state: OverrideState) =>
    post<{ ok: true }>(`/api/vocab/override/${w}/${r}`, { state }, 'PUT'),
  clearOverride: (w: number, r: number) =>
    post<{ ok: true }>(`/api/vocab/override/${w}/${r}`, undefined, 'DELETE'),
  recordMined: (wordId: number, readingIndex: number, noteId: number | null) =>
    post<{ ok: true }>('/api/vocab/mined', { wordId, readingIndex, noteId }),
  status: () =>
    post<{ configured: boolean; parseCache: number; vocabStates: number; pausedForMs: number }>(
      '/api/jiten/status',
      undefined,
      'GET'
    )
};

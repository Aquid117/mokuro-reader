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

/** Word info stored with a mark so the "Marked words" page can list it. */
export interface WordInfo {
  spelling?: string;
  reading?: string;
  meaning?: string;
}

export interface MarkedWord {
  wordId: number;
  readingIndex: number;
  state: OverrideState;
  updatedAt: number;
  spelling: string | null;
  reading: string | null;
  meaning: string | null;
  jitenSync: 'pending' | 'ok' | 'error' | null;
  jitenError: string | null;
}

export interface SeriesIgnore {
  series: string;
  wordId: number;
  readingIndex: number;
  spelling: string | null;
  reading: string | null;
  meaning: string | null;
  createdAt: number;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const familiarityApi = {
  parse: (blocks: { key: string; text: string }[], series?: string) =>
    post<ParseResponse>('/api/jiten/parse', { blocks, series }),
  refresh: () => post<{ refreshed: number }>('/api/jiten/refresh', {}),
  /** known is mirrored to Jiten ("Never forget"); learning stays in the reader */
  setOverride: (w: number, r: number, state: 'known' | 'learning', info: WordInfo = {}) =>
    post<{ ok: true }>(`/api/vocab/override/${w}/${r}`, { state, ...info }, 'PUT'),
  clearOverride: (w: number, r: number) =>
    post<{ ok: true }>(`/api/vocab/override/${w}/${r}`, undefined, 'DELETE'),
  listOverrides: (state?: OverrideState, q?: string) =>
    post<{ overrides: MarkedWord[] }>(`/api/vocab/overrides${qs({ state, q })}`, undefined, 'GET'),
  /** per-series ignore list (names, sound effects); never sent to Jiten */
  ignoreInSeries: (series: string, w: number, r: number, info: WordInfo = {}) =>
    post<{ ok: true }>(
      '/api/vocab/series-ignores',
      { series, wordId: w, readingIndex: r, ...info },
      'PUT'
    ),
  unignoreInSeries: (series: string, w: number, r: number) =>
    post<{ ok: boolean }>(
      `/api/vocab/series-ignores/${w}/${r}${qs({ series })}`,
      undefined,
      'DELETE'
    ),
  listSeriesIgnores: (series?: string, q?: string) =>
    post<{ ignores: SeriesIgnore[]; series: { series: string; n: number }[] }>(
      `/api/vocab/series-ignores${qs({ series, q })}`,
      undefined,
      'GET'
    ),
  recordMined: (
    wordId: number,
    readingIndex: number,
    noteId: number | null,
    bubbleText?: string,
    word?: string
  ) => post<{ ok: true }>('/api/vocab/mined', { wordId, readingIndex, noteId, bubbleText, word }),
  /** cards mined from this speech bubble */
  minedForBubble: (text: string) =>
    post<{
      mined: { wordId: number; readingIndex: number; noteId: number; word: string | null }[];
    }>(`/api/vocab/mined${qs({ text })}`, undefined, 'GET'),
  status: () =>
    post<{ configured: boolean; parseCache: number; vocabStates: number; pausedForMs: number }>(
      '/api/jiten/status',
      undefined,
      'GET'
    )
};

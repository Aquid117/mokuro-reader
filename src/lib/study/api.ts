import { writable, get } from 'svelte/store';

/** Difficulty per volume and pre-study word lists (manga-immersion fork; manga-api /api/study). */
export interface Coverage {
  totalTokens: number;
  knownTokens: number;
  learningTokens: number;
  newTokens: number;
  known: number;
  learning: number;
  new: number;
  uniqueNew: number;
  uniqueLearning: number;
  uniqueWords: number;
  label: 'easy' | 'ok' | 'hard';
}

export interface VolumeSummary {
  volume: string;
  status: 'missing' | 'queued' | 'running' | 'done' | 'error';
  error?: string | null;
  pages?: number;
  analyzedAt?: number | null;
  coverage?: Coverage | null;
}

export type StudyCategory = 'known' | 'learning' | 'new' | 'ignored';

export interface StudyWord {
  wordId: number;
  readingIndex: number;
  spelling: string;
  reading: string;
  meanings: string[][];
  pos: string[];
  freq: number;
  pitch: number[];
  jiten: number[];
  override: string | null;
  category: StudyCategory;
  mined: boolean;
  count: number;
  example: {
    page: number;
    block: number;
    text: string;
    s: number;
    e: number;
    box: [number, number, number, number];
    pageSize: { width: number; height: number };
  } | null;
}

async function get_<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', redirect: 'manual' });
  if (res.type === 'opaqueredirect' || res.status === 401)
    throw new Error('Not signed in, reload the page');
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json')
    ? ((await res.json()) as Record<string, unknown>)
    : null;
  if (!res.ok) throw new Error(String(body?.error ?? `backend error ${res.status}`));
  return body as T;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const studyApi = {
  series: (series: string) =>
    get_<{ volumes: VolumeSummary[]; refreshing: boolean }>(`/api/study/series?${q({ series })}`),
  volume: (series: string, volume: string, all = false) =>
    get_<{ summary: VolumeSummary; words: StudyWord[]; refreshing: boolean }>(
      `/api/study/volume?${q({ series, volume, ...(all ? { all: '1' } : {}) })}`
    ),
  pageImageUrl: (series: string, volume: string, page: number) =>
    `/api/study/page-image?${q({ series, volume, page: String(page) })}`
};

/** Per-series coverage cache for the volume badges; polls while analyses are pending. */
export const seriesStudy = writable<Record<string, Record<string, VolumeSummary>>>({});
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export async function loadSeriesStudy(series: string, attempt = 0): Promise<void> {
  if (!series) return;
  const t = timers.get(series);
  if (t) clearTimeout(t);
  try {
    const res = await studyApi.series(series);
    seriesStudy.update((all) => ({
      ...all,
      [series]: Object.fromEntries(res.volumes.map((v) => [v.volume, v]))
    }));
    const pending = res.volumes.some((v) => v.status === 'queued' || v.status === 'running');
    // keep polling while volumes are analysed (about 10 s each) or states are being refreshed
    if ((pending || res.refreshing) && attempt < 120) {
      timers.set(
        series,
        setTimeout(() => void loadSeriesStudy(series, attempt + 1), pending ? 6000 : 15000)
      );
    }
  } catch {
    // backend unavailable: badges just stay hidden
  }
}

export function studySummary(series: string, volume: string): VolumeSummary | undefined {
  return get(seriesStudy)[series]?.[volume];
}

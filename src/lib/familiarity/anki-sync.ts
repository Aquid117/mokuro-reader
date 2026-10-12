import { writable, get } from 'svelte/store';

/**
 * AnkiWeb sync state of the server-side Anki (manga-immersion backend). Cards are synced
 * automatically a short while after the last mined card and every few hours; this module shows that
 * state and lets the user force a sync ("Sync now").
 */
export interface AnkiSyncStatus {
  lastSync: { ts: number; reason: string; ok: boolean; error: string | null } | null;
  nextScheduledAt: number | null;
  debounceAt: number | null;
  running: boolean;
  unsyncedNotes: number;
  consecutiveFailures: number;
  autoSync?: { enabled: boolean; afterMiningSec: number; intervalMin: number };
}

export const ankiSync = writable<{ status: AnkiSyncStatus | null; syncing: boolean }>({
  status: null,
  syncing: false
});

async function request(method: 'GET' | 'POST', path: string): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? '{}' : undefined,
    credentials: 'same-origin',
    redirect: 'manual'
  });
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
    throw new Error('not signed in — reload the page');
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new Error(`backend error ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if (res.status === 429)
    throw Object.assign(new Error('too many sync requests, wait a minute'), { body });
  if (!res.ok && !body.sync) throw new Error(`backend error ${res.status}`);
  return body;
}

export async function refreshAnkiSync(): Promise<AnkiSyncStatus | null> {
  try {
    const body = await request('GET', '/api/anki/status');
    const status = (body.sync as AnkiSyncStatus) ?? null;
    ankiSync.update((s) => ({ ...s, status }));
    return status;
  } catch {
    return get(ankiSync).status;
  }
}

/** Forces an AnkiWeb sync and waits for it. Returns null on success, else the reason. */
export async function syncAnkiNow(): Promise<string | null> {
  if (get(ankiSync).syncing) return 'a sync is already running';
  ankiSync.update((s) => ({ ...s, syncing: true }));
  try {
    const body = await request('POST', '/api/anki/sync');
    ankiSync.update((s) => ({ ...s, status: (body.sync as AnkiSyncStatus) ?? s.status }));
    return body.ok ? null : String(body.error ?? 'sync failed');
  } catch (e) {
    return (e as Error).message;
  } finally {
    ankiSync.update((s) => ({ ...s, syncing: false }));
  }
}

function ago(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function inTime(ms: number): string {
  const min = Math.ceil(ms / 60000);
  if (min <= 1) return 'in under a minute';
  if (min < 60) return `in ${min} min`;
  return `in ${Math.round(min / 60)} h`;
}

/** One-line human summary, e.g. "Last sync 3 min ago · 2 cards waiting, auto sync in 1 min". */
export function describeAnkiSync(s: AnkiSyncStatus | null, now = Date.now()): string {
  if (!s) return 'Sync status unavailable';
  const parts: string[] = [];
  if (s.running) parts.push('Syncing with AnkiWeb…');
  else if (!s.lastSync) parts.push('Not synced yet');
  else if (s.lastSync.ok) parts.push(`Last sync ${ago(now - s.lastSync.ts)}`);
  else
    parts.push(
      `Last sync failed ${ago(now - s.lastSync.ts)}: ${s.lastSync.error ?? 'unknown error'}`
    );
  if (s.unsyncedNotes > 0) {
    const cards = `${s.unsyncedNotes} card${s.unsyncedNotes === 1 ? '' : 's'} waiting`;
    parts.push(s.debounceAt ? `${cards}, auto sync ${inTime(s.debounceAt - now)}` : cards);
  } else if (s.nextScheduledAt && !s.running) {
    parts.push(`next auto sync ${inTime(s.nextScheduledAt - now)}`);
  }
  return parts.join(' · ');
}

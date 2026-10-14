import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import { selectCleanupCandidates } from './storage-cleanup';
import { fetchBunkoCredentials } from './bunko-autoconnect';
import { checkSession, sessionExpired } from './session';
import type { VolumeMetadata } from '$lib/types';

const DAY = 86_400_000;
const now = Date.parse('2026-10-14T12:00:00Z');

function row(uuid: string, extra: Partial<VolumeMetadata> = {}): VolumeMetadata {
  return { volume_uuid: uuid, series_title: 'S', volume_title: uuid, ...extra } as VolumeMetadata;
}

describe('storage cleanup selection', () => {
  const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
  const base = {
    afterDays: 7,
    now,
    inCloud: (_s: string, v: string) => v !== 'local-only'
  };

  it('picks finished, installed, server-backed volumes older than the limit, oldest first', () => {
    const picked = selectCleanupCandidates({
      ...base,
      rows: [
        row('old'),
        row('older'),
        row('recent'),
        row('unfinished'),
        row('local-only'),
        row('removed', { metadata_only: true }),
        row('cloud-only', { isPlaceholder: true } as Partial<VolumeMetadata>),
        row('open')
      ],
      volumeData: {
        old: { completed: true, completedAt: iso(8) },
        older: { completed: true, completedAt: iso(30) },
        recent: { completed: true, completedAt: iso(2) },
        unfinished: { completed: false, lastProgressUpdate: iso(60) },
        'local-only': { completed: true, completedAt: iso(30) },
        removed: { completed: true, completedAt: iso(30) },
        'cloud-only': { completed: true, completedAt: iso(30) },
        open: { completed: true, completedAt: iso(30) }
      },
      openVolumeUuid: 'open'
    });
    expect(picked.map((c) => c.uuid)).toEqual(['older', 'old']);
  });

  it('falls back to the last progress update and supports "right away"', () => {
    const picked = selectCleanupCandidates({
      ...base,
      afterDays: 0,
      rows: [row('a'), row('b')],
      volumeData: {
        a: { completed: true, lastProgressUpdate: iso(0) },
        b: { completed: true } // no date: never removed
      }
    });
    expect(picked.map((c) => c.uuid)).toEqual(['a']);
  });
});

describe('Bunko auto-connect credentials', () => {
  const fake = (res: Response) => (async () => res) as unknown as typeof fetch;

  it('returns the server login', async () => {
    const res = new Response(
      JSON.stringify({ serverUrl: 'https://bunko.example', username: 'reader', password: 'pw' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
    expect(await fetchBunkoCredentials(fake(res))).toEqual({
      serverUrl: 'https://bunko.example',
      username: 'reader',
      password: 'pw'
    });
  });

  it('gives up quietly when not offered (debug port, not configured, network)', async () => {
    expect(await fetchBunkoCredentials(fake(new Response('{}', { status: 403 })))).toBeNull();
    expect(
      await fetchBunkoCredentials((async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch)
    ).toBeNull();
  });
});

describe('session check', () => {
  it('flags an expired login and clears the flag again', async () => {
    await checkSession((async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    expect(get(sessionExpired)).toBe(true);
    await checkSession(
      (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    );
    expect(get(sessionExpired)).toBe(false);
  });

  it('does not treat being offline as an expired login', async () => {
    sessionExpired.set(false);
    await checkSession((async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch);
    expect(get(sessionExpired)).toBe(false);
  });
});

import { get, writable } from 'svelte/store';
import { db } from '$lib/catalog/db';
import { removeVolumeFiles } from '$lib/import/database';
import { isVolumeInstalled } from '$lib/catalog/volume-state';
import { settings, volumes } from '$lib/settings';
import { currentView } from '$lib/util/hash-router';
import type { VolumeMetadata } from '$lib/types';

/**
 * manga-immersion fork: free device storage by removing the pages of finished volumes some days after
 * they were finished. Only volumes that also exist on the server (Bunko) are touched; the volume row,
 * cover, progress and stats stay (same as "Remove from this device"), and tapping it downloads it again.
 */
export interface CleanupCandidate {
  uuid: string;
  series: string;
  volume: string;
  finishedAt: number;
}

export interface CleanupDeps {
  rows: VolumeMetadata[];
  volumeData: Record<
    string,
    { completed?: boolean; completedAt?: string; lastProgressUpdate?: string }
  >;
  afterDays: number;
  now: number;
  inCloud: (series: string, volume: string) => boolean;
  openVolumeUuid?: string;
}

export function selectCleanupCandidates(d: CleanupDeps): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  const minAge = d.afterDays * 86_400_000;
  for (const row of d.rows) {
    if (!isVolumeInstalled(row) || row.volume_uuid === d.openVolumeUuid) continue;
    const vd = d.volumeData[row.volume_uuid];
    if (!vd?.completed) continue;
    const finishedAt = Date.parse(vd.completedAt ?? vd.lastProgressUpdate ?? '');
    if (!Number.isFinite(finishedAt) || d.now - finishedAt < minAge) continue;
    if (!d.inCloud(row.series_title, row.volume_title)) continue; // never the only copy
    out.push({
      uuid: row.volume_uuid,
      series: row.series_title,
      volume: row.volume_title,
      finishedAt
    });
  }
  return out.sort((a, b) => a.finishedAt - b.finishedAt);
}

export const lastCleanup = writable<{ at: number; removed: number } | null>(null);

async function cloudLookup(): Promise<((series: string, volume: string) => boolean) | null> {
  const { unifiedCloudManager } = await import('$lib/util/sync/unified-cloud-manager');
  const files = get(unifiedCloudManager.cloudFiles);
  if (!files || files.size === 0) return null; // listing not loaded yet: decide nothing
  return (series, volume) => unifiedCloudManager.getCloudFile(series, volume) !== null;
}

/** Volumes that would be removed now (for the settings preview and the run itself). */
export async function findCleanupCandidates(
  afterDays?: number
): Promise<CleanupCandidate[] | null> {
  const inCloud = await cloudLookup();
  if (!inCloud) return null;
  const view = get(currentView);
  return selectCleanupCandidates({
    rows: await db.volumes.toArray(),
    volumeData: get(volumes) as CleanupDeps['volumeData'],
    afterDays: afterDays ?? get(settings).storage?.afterDays ?? 7,
    now: Date.now(),
    inCloud,
    openVolumeUuid: view.type === 'reader' ? view.volumeId : undefined
  });
}

let running = false;

export async function runStorageCleanup(opts: { force?: boolean } = {}): Promise<number | null> {
  const cfg = get(settings).storage;
  if (running || (!opts.force && !cfg?.autoRemoveFinished)) return null;
  running = true;
  try {
    const candidates = await findCleanupCandidates(cfg?.afterDays);
    if (!candidates) return null;
    for (const c of candidates) await removeVolumeFiles(c.uuid);
    if (candidates.length) {
      // the catalog follows the database (live query), so covers turn into "download" cards by themselves
      console.log(
        `[storage-cleanup] removed ${candidates.length} finished volume(s) from this device`
      );
    }
    lastCleanup.set({ at: Date.now(), removed: candidates.length });
    return candidates.length;
  } finally {
    running = false;
  }
}

let started = false;

/** Once the server listing is loaded, then every 6 h while the app is open. */
export function startStorageCleanup(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void navigator.storage?.persist?.().catch(() => false); // ask the browser not to evict our data
  void import('$lib/util/sync/unified-cloud-manager').then(({ unifiedCloudManager }) => {
    let done = false;
    unifiedCloudManager.cloudFiles.subscribe((files) => {
      if (done || !files || files.size === 0) return;
      done = true;
      setTimeout(() => void runStorageCleanup(), 5_000);
    });
  });
  setInterval(() => void runStorageCleanup(), 6 * 60 * 60_000);
}

import { removeVolumeFiles } from '$lib/import';
import { isVolumeInstalled } from '$lib/catalog/volume-state';
import { db } from '$lib/catalog/db';
import type { VolumeMetadata } from '$lib/types';
import { promptConfirmation, showSnackbar } from '$lib/util';

/**
 * manga-immersion fork: delete volumes or series from the Bunko library. manga-api moves the files into a
 * server trash (restorable for 30 days, page #/trash); the reader then refreshes its cloud listing.
 * Progress and stats are never touched; the local copy is removed only when asked.
 */
export interface TrashEntry {
  id: string;
  kind: 'volume' | 'series';
  series: string;
  volumes: string[];
  files: string[];
  bytes: number;
  deletedAt: number;
  expiresAt: number;
  user: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    redirect: 'manual'
  });
  if (res.type === 'opaqueredirect' || res.status === 401)
    throw new Error('Not signed in, reload the page');
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? `backend error ${res.status}`);
  return data as T;
}

export const trashApi = {
  list: () => call<{ entries: TrashEntry[] }>('GET', '/api/library/trash'),
  trash: (series: string, volume?: string) =>
    call<{ ok: boolean; entry: TrashEntry }>('POST', '/api/library/trash', { series, volume }),
  restore: (id: string) =>
    call<{ ok: boolean; entry: TrashEntry }>(
      'POST',
      `/api/library/trash/${encodeURIComponent(id)}/restore`
    ),
  purge: (id: string) =>
    call<{ ok: boolean; entry: TrashEntry }>(
      'DELETE',
      `/api/library/trash/${encodeURIComponent(id)}`
    )
};

async function refreshCloud(): Promise<void> {
  try {
    const { unifiedCloudManager } = await import('$lib/util/sync/unified-cloud-manager');
    await unifiedCloudManager.fetchAllCloudVolumes();
  } catch (e) {
    console.warn('[server-trash] cloud refresh failed', e);
  }
}

const WHERE = 'You can restore it for 30 days (Settings → Device storage → Server trash).';

/** "Delete from server" for one volume (asks first; optionally removes the local copy too). */
export function deleteVolumeFromServer(volume: VolumeMetadata, onDone?: () => void): void {
  const installed = isVolumeInstalled(volume);
  promptConfirmation(
    `Move “${volume.volume_title}” to the server trash? It disappears from Bunko on all your devices. ${WHERE}`,
    async (removeLocal) => {
      try {
        await trashApi.trash(volume.series_title, volume.volume_title);
        if (installed && removeLocal) await removeVolumeFiles(volume.volume_uuid);
        await refreshCloud();
        showSnackbar(`Moved ${volume.volume_title} to the server trash`);
        onDone?.();
      } catch (e) {
        showSnackbar(`Could not delete: ${(e as Error).message}`);
      }
    },
    undefined,
    installed
      ? {
          label: 'Also remove it from this device',
          storageKey: 'serverDeleteLocalToo',
          defaultValue: true
        }
      : undefined
  );
}

/** "Delete series from server": every volume of the series folder goes to the trash in one entry. */
export function deleteSeriesFromServer(seriesTitle: string, onDone?: () => void): void {
  promptConfirmation(
    `Move the whole series “${seriesTitle}” to the server trash? All its volumes disappear from Bunko on all your devices. ${WHERE}`,
    async (removeLocal) => {
      try {
        const { entry } = await trashApi.trash(seriesTitle);
        if (removeLocal) {
          const local = await db.volumes.where('series_title').equals(seriesTitle).toArray();
          for (const v of local) if (isVolumeInstalled(v)) await removeVolumeFiles(v.volume_uuid);
        }
        await refreshCloud();
        showSnackbar(`Moved ${seriesTitle} (${entry.volumes.length} volumes) to the server trash`);
        onDone?.();
      } catch (e) {
        showSnackbar(`Could not delete: ${(e as Error).message}`);
      }
    },
    undefined,
    {
      label: 'Also remove its volumes from this device',
      storageKey: 'serverDeleteLocalToo',
      defaultValue: true
    }
  );
}

export async function restoreFromTrash(id: string): Promise<TrashEntry> {
  const { entry } = await trashApi.restore(id);
  await refreshCloud();
  return entry;
}

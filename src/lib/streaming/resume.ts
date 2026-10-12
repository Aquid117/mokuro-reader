/**
 * Imported by the reader only. When a partially streamed volume is opened:
 *  - streaming on  → continue filling its pages in the background;
 *  - streaming off → repair it: drop the partial pages (history kept, `removeVolumeFiles`), run the normal
 *    full download and reopen the volume when it is installed.
 */
import { get } from 'svelte/store';
import { currentVolume, volumesWithPlaceholders } from '$lib/catalog';
import { removeVolumeFiles } from '$lib/import/database';
import { getCloudFileId } from '$lib/util/cloud-fields';
import type { VolumeMetadata } from '$lib/types';
import {
  resumeIfPending,
  hasPendingStream,
  forgetPendingStream,
  streamingEnabled,
  fullDownloadAndOpen
} from './progressive';
import { reportClientIssue } from './diagnostics';

let lastUuid: string | undefined;

async function repair(uuid: string): Promise<void> {
  forgetPendingStream(uuid);
  await removeVolumeFiles(uuid);
  // wait until the catalog decorates the history-only row with its cloud file again
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const all = get(volumesWithPlaceholders) as unknown;
    const list = Array.isArray(all)
      ? all
      : Object.values((all ?? {}) as Record<string, VolumeMetadata>);
    const row = (list as VolumeMetadata[]).find((x) => x.volume_uuid === uuid);
    if (row && getCloudFileId(row)) {
      fullDownloadAndOpen(row, row.series_title);
      return;
    }
  }
  reportClientIssue('stream repair: cloud copy not found', { uuid });
}

if (typeof window !== 'undefined') {
  currentVolume.subscribe((v) => {
    if (!v) {
      lastUuid = undefined; // left the reader: the next open of any volume is checked again
      return;
    }
    if (v.volume_uuid === lastUuid) return;
    lastUuid = v.volume_uuid;
    if (!hasPendingStream(v.volume_uuid)) return;
    if (streamingEnabled()) resumeIfPending(v);
    else void repair(v.volume_uuid);
  });
}

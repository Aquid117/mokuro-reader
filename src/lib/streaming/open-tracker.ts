/**
 * "Tap to read" for not-installed cloud volumes (manga-immersion fork): remembers which volume the user
 * tapped, so DownloadOverlay can show the download's progress right away and open the reader as soon as
 * the volume is installed.
 */
import { writable } from 'svelte/store';

export interface PendingOpen {
  uuid: string;
  fileId: string;
  title: string;
  seriesTitle: string;
  seriesId?: string;
  startedAt: number;
  error?: string;
}

export const pendingOpens = writable<PendingOpen[]>([]);

export function trackOpen(p: Omit<PendingOpen, 'startedAt'>): void {
  pendingOpens.update((all) => [
    ...all.filter((x) => x.uuid !== p.uuid),
    { ...p, startedAt: Date.now() }
  ]);
}

export function untrackOpen(uuid: string): void {
  pendingOpens.update((all) => all.filter((x) => x.uuid !== uuid));
}

export function markOpenFailed(uuid: string, error: string): void {
  pendingOpens.update((all) => all.map((x) => (x.uuid === uuid ? { ...x, error } : x)));
}

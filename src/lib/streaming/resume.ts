/** Imported by the reader only: continue filling a partially streamed volume when it is opened again. */
import { currentVolume } from '$lib/catalog';
import { resumeIfPending } from './progressive';

let lastUuid: string | undefined;
if (typeof window !== 'undefined') {
  currentVolume.subscribe((v) => {
    if (!v || v.volume_uuid === lastUuid) return;
    lastUuid = v.volume_uuid;
    resumeIfPending(v);
  });
}

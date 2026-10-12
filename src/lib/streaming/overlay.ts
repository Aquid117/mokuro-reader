/**
 * In-memory overlay of pages fetched by the progressive loader (manga-immersion fork), merged into the
 * volume's stored file map when the reader loads it (catalog/index.ts → loadCurrentVolumeData).
 *
 * The reader's image cache compares pages by File identity, so for volumes that are (or just were)
 * streaming, unchanged pages are handed back as the *same* File objects: only newly arrived pages
 * re-render when the volume reloads after a batch.
 */
export interface StreamOverlay {
  /** OCR img_path (key of the placeholder in volume_files) → archive entry name (key of the real file) */
  pageToEntry: Map<string, string>;
  /** archive entry name → fetched page */
  fetched: Map<string, File>;
}

const overlays = new Map<string, StreamOverlay>();
const stabilized = new Set<string>();
let stableUuid: string | null = null;
let stable = new Map<string, File>();

export function getOverlay(uuid: string): StreamOverlay | undefined {
  return overlays.get(uuid);
}

export function setOverlay(uuid: string, overlay: StreamOverlay): void {
  overlays.set(uuid, overlay);
  stabilized.add(uuid);
}

export function dropOverlay(uuid: string): void {
  overlays.delete(uuid); // keep `stabilized` so the final reload reuses the same File objects
}

export function mergeStreamOverlay(
  uuid: string,
  files: Record<string, File> | undefined
): Record<string, File> | undefined {
  if (!files || !stabilized.has(uuid)) return files;
  let merged = files;
  const ov = overlays.get(uuid);
  if (ov && ov.fetched.size > 0) {
    merged = { ...files };
    for (const [pagePath, entry] of ov.pageToEntry) {
      const f = ov.fetched.get(entry);
      if (!f) continue;
      if (pagePath !== entry) delete merged[pagePath];
      merged[entry] = f;
    }
  }
  if (stableUuid !== uuid) {
    stableUuid = uuid;
    stable = new Map();
  }
  const out: Record<string, File> = {};
  const next = new Map<string, File>();
  for (const [k, f] of Object.entries(merged)) {
    const prev = stable.get(k);
    const use =
      prev && prev.size === f.size && prev.type === f.type && prev.name === f.name ? prev : f;
    out[k] = use;
    next.set(k, use);
  }
  stable = next;
  return out;
}

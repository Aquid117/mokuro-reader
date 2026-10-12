/**
 * Progressive ("streaming") opening of cloud volumes (manga-immersion fork).
 *
 * Tapping a not-installed WebDAV/Bunko volume no longer waits for the whole CBZ: the archive's central
 * directory and the pages around the reading position are fetched with HTTP Range requests, the volume
 * is installed through the normal import pipeline with the remaining pages marked missing (shown as
 * "Loading…" placeholders with their OCR text), the reader opens, and the rest is fetched in the
 * background in reading order. Fetched pages live in memory + Cache Storage (survive a reload) and are
 * written to IndexedDB once, when the volume is complete; it is then an ordinary offline volume.
 * "Download all" and image-only volumes keep using the full download.
 */
import { writable, get } from 'svelte/store';
import { db } from '$lib/catalog/db';
import { settings, volumes as volumeProgress } from '$lib/settings';
import type { VolumeMetadata } from '$lib/types';
import { unifiedCloudManager } from '$lib/util/sync/unified-cloud-manager';
import { getCloudFileId, getCloudProvider } from '$lib/util/cloud-fields';
import {
  webdavAuthHeaders,
  authFromCredentials
} from '$lib/util/sync/core/providers/webdav-authorization';
import { downloadQueue, processVolumeData, downloadSidecarEntries } from '$lib/util/download-queue';
import { normalizeFilename } from '$lib/util/misc';
import { isImageExtension, getImageMimeType, isSystemFile } from '$lib/import';
import { nav } from '$lib/util/hash-router';
import { showSnackbar } from '$lib/util';
import { RemoteZip, type RemoteZipEntry } from './remote-zip';
import { mapPagesToEntries } from './page-map';
import { setOverlay, getOverlay, dropOverlay } from './overlay';

export interface StreamStatus {
  done: number;
  total: number;
  state: 'loading' | 'paused' | 'complete' | 'error';
  error?: string;
}
export const streamStatus = writable<Record<string, StreamStatus>>({});

const PENDING_KEY = 'mokuro-stream-pending';
const CACHE_NAME = 'mokuro-stream-pages';
const INITIAL_BEFORE = 1;
const INITIAL_AFTER = 5;
const BATCH = 6;

interface Pending {
  fileId: string;
  /** [img_path, archive entry name] for pages still missing when the volume was installed */
  pages: [string, string][];
  /** pages the archive has no image for at all (stay "missing" for good) */
  absent?: string[];
}

function readPending(): Record<string, Pending> {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
  } catch {
    return {};
  }
}
function writePending(p: Record<string, Pending>): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: resume will not survive a reload */
  }
}

const active = new Set<string>();

function setStatus(uuid: string, s: StreamStatus | null): void {
  streamStatus.update((all) => {
    const next = { ...all };
    if (s) next[uuid] = s;
    else delete next[uuid];
    return next;
  });
}

function canStream(volume: VolumeMetadata): boolean {
  const s = get(settings) as { streamVolumes?: boolean };
  if (s.streamVolumes === false) return false;
  return (
    getCloudProvider(volume) === 'webdav' &&
    !!getCloudFileId(volume) &&
    typeof DecompressionStream !== 'undefined'
  );
}

async function openArchive(fileId: string): Promise<RemoteZip> {
  const provider = unifiedCloudManager.getActiveProvider();
  if (!provider || provider.type !== 'webdav' || !provider.getWorkerDownloadCredentials)
    throw new Error('WebDAV not connected');
  const creds = await provider.getWorkerDownloadCredentials(fileId);
  const base = String(creds.webdavUrl ?? '').replace(/\/$/, '');
  if (!base) throw new Error('WebDAV URL unknown');
  const url = base + fileId.split('/').map(encodeURIComponent).join('/');
  return new RemoteZip(url, webdavAuthHeaders(authFromCredentials(creds))).open();
}

async function gunzipText(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function cacheKey(uuid: string, entry: string): string {
  return `https://stream.invalid/${uuid}/${encodeURIComponent(entry)}`;
}

function pageFile(entry: string, data: Uint8Array): File {
  const name = normalizeFilename(entry);
  const ext = name.toLowerCase().split('.').pop() || '';
  return new File([data as BlobPart], name, { type: getImageMimeType(ext) });
}

/**
 * Entry point for a tap on a not-installed volume. Streams when possible, otherwise (or on any error
 * before the volume is installed) falls back to the regular full download.
 */
export async function openCloudVolume(volume: VolumeMetadata, seriesId?: string): Promise<void> {
  if (!canStream(volume)) {
    downloadQueue.queueVolume(volume);
    return;
  }
  const fileId = getCloudFileId(volume)!;
  if (active.has(volume.volume_uuid)) return;
  active.add(volume.volume_uuid);
  setStatus(volume.volume_uuid, { done: 0, total: volume.page_count || 0, state: 'loading' });
  try {
    const zip = await openArchive(fileId);
    const imageEntries = zip.entries.filter((e) => {
      const n = normalizeFilename(e.name);
      return !isSystemFile(n) && isImageExtension(n.toLowerCase().split('.').pop() || '');
    });

    // OCR: listed sidecar first (Bunko), else a .mokuro inside the archive
    const sidecars = await downloadSidecarEntries(volume);
    let mokuroText: string | null = null;
    for (const s of sidecars) {
      if (s.filename.endsWith('.mokuro')) mokuroText = new TextDecoder().decode(s.data);
      else if (!mokuroText && s.filename.endsWith('.mokuro.gz'))
        mokuroText = await gunzipText(s.data);
    }
    const extraEntries: { filename: string; data: ArrayBuffer }[] = [];
    if (!mokuroText) {
      const inner = zip.entries.find((e) => e.name.toLowerCase().endsWith('.mokuro'));
      if (inner) {
        const data = await zip.read(inner);
        mokuroText = new TextDecoder().decode(data);
        extraEntries.push({ filename: inner.name, data: data.slice().buffer as ArrayBuffer });
      }
    }
    if (!mokuroText) throw new Error('no OCR data (image-only volume)');
    const mokuro = JSON.parse(mokuroText) as {
      volume_uuid?: string;
      pages: { img_path: string }[];
    };
    const pagePaths = mokuro.pages.map((p) => p.img_path);
    const map = mapPagesToEntries(
      pagePaths,
      imageEntries.map((e) => normalizeFilename(e.name))
    );

    const startIndex = Math.max(
      0,
      (get(volumeProgress)[mokuro.volume_uuid ?? volume.volume_uuid]?.progress || 1) - 1
    );
    const initial = new Set<number>([0, 1]);
    for (let i = startIndex - INITIAL_BEFORE; i <= startIndex + INITIAL_AFTER; i++)
      if (i >= 0 && i < pagePaths.length) initial.add(i);
    const initialEntries = [...initial]
      .map((i) => imageEntries[map[i]])
      .filter(Boolean) as RemoteZipEntry[];
    const fetched = await zip.readMany(initialEntries);

    const entries = [
      ...sidecars,
      ...extraEntries,
      ...[...fetched].map(([filename, data]) => ({
        filename,
        data: data.slice().buffer as ArrayBuffer
      }))
    ];
    await processVolumeData(entries, volume, undefined, { placeholderLabel: 'Loading…' });

    const uuid =
      mokuro.volume_uuid && (await db.volumes.get(mokuro.volume_uuid))
        ? mokuro.volume_uuid
        : volume.volume_uuid;
    const row = await db.volumes.get(uuid);
    if (!row) throw new Error('volume was not installed');

    const remaining: [string, string][] = [];
    const absent: string[] = [];
    pagePaths.forEach((p, i) => {
      if (map[i] < 0) absent.push(p);
      else if (!initial.has(i)) remaining.push([p, normalizeFilename(imageEntries[map[i]].name)]);
    });
    if (remaining.length > 0) {
      const pending = readPending();
      pending[uuid] = { fileId, pages: remaining, absent };
      writePending(pending);
      setOverlay(uuid, { pageToEntry: new Map(remaining), fetched: new Map() });
    }
    if (uuid !== volume.volume_uuid) setStatus(volume.volume_uuid, null);
    setStatus(uuid, {
      done: pagePaths.length - remaining.length,
      total: pagePaths.length,
      state: remaining.length ? 'loading' : 'complete'
    });
    nav.toReader(seriesId || row.series_title, uuid);
    if (remaining.length > 0) void fill(uuid, zip);
    else setTimeout(() => setStatus(uuid, null), 3000);
  } catch (e) {
    console.warn('[stream] falling back to full download:', e);
    setStatus(volume.volume_uuid, null);
    downloadQueue.queueVolume(volume);
  } finally {
    active.delete(volume.volume_uuid);
  }
}

/** Background fill: fetch missing pages nearest the reading position first; finalize when complete. */
async function fill(uuid: string, zipIn?: RemoteZip): Promise<void> {
  if (active.has(`fill:${uuid}`)) return;
  active.add(`fill:${uuid}`);
  try {
    const pending = readPending()[uuid];
    if (!pending) return;
    const ov = getOverlay(uuid) ?? {
      pageToEntry: new Map(pending.pages),
      fetched: new Map<string, File>()
    };
    setOverlay(uuid, ov);
    const row = await db.volumes.get(uuid);
    if (!row) {
      forget(uuid);
      return;
    }
    const total = row.page_count || pending.pages.length;

    // restore pages fetched before a reload
    const cache =
      typeof caches !== 'undefined' ? await caches.open(CACHE_NAME).catch(() => null) : null;
    if (cache) {
      for (const [, entry] of pending.pages) {
        if (ov.fetched.has(entry)) continue;
        const hit = await cache.match(cacheKey(uuid, entry));
        if (hit) ov.fetched.set(entry, pageFile(entry, new Uint8Array(await hit.arrayBuffer())));
      }
    }
    const absent = pending.absent ?? [];
    const missingOf = () => pending.pages.filter(([, e]) => !ov.fetched.has(e));
    const stillMissing = () => [...missingOf().map(([p]) => p), ...absent];
    if (missingOf().length < pending.pages.length) await touchRow(uuid, stillMissing());

    const zip = zipIn ?? (await openArchive(pending.fileId));
    const entryByName = new Map(zip.entries.map((e) => [normalizeFilename(e.name), e]));
    // real page numbers (from the stored OCR pages) for reading-order priority
    const ocr = await db.volume_ocr.get(uuid);
    const indexOf = new Map<string, number>(
      (ocr?.pages ?? []).map((p, i) => [p.img_path, i] as const)
    );
    let failures = 0;

    while (missingOf().length > 0) {
      const progress = (get(volumeProgress)[uuid]?.progress || 1) - 1;
      // order: pages from the reading position forward, then the ones behind (nearest first)
      const cur = progress;
      const ordered = missingOf().sort(([a], [b]) => {
        const ia = indexOf.get(a) ?? 0;
        const ib = indexOf.get(b) ?? 0;
        const da = ia >= cur ? ia - cur : 10000 + (cur - ia);
        const dbb = ib >= cur ? ib - cur : 10000 + (cur - ib);
        return da - dbb;
      });
      const batch = ordered.slice(0, BATCH);
      const list = batch.map(([, e]) => entryByName.get(e)).filter(Boolean) as RemoteZipEntry[];
      if (list.length === 0) break;
      setStatus(uuid, { done: total - missingOf().length, total, state: 'loading' });
      let data: Map<string, Uint8Array>;
      try {
        data = await zip.readMany(list);
        failures = 0;
      } catch (e) {
        failures++;
        if (failures >= 4) {
          setStatus(uuid, {
            done: total - missingOf().length,
            total,
            state: 'paused',
            error: String((e as Error).message ?? e)
          });
          return; // resumes next time the volume is opened
        }
        await new Promise((r) => setTimeout(r, 1500 * failures));
        continue;
      }
      for (const [name, bytes] of data) {
        const entry = normalizeFilename(name);
        const file = pageFile(entry, bytes);
        ov.fetched.set(entry, file);
        if (cache) await cache.put(cacheKey(uuid, entry), new Response(file)).catch(() => {});
      }
      await touchRow(uuid, stillMissing());
    }

    // complete: persist the full file map once, clear temporary state
    const vf = await db.volume_files.get(uuid);
    if (vf) {
      const files = { ...vf.files };
      for (const [pagePath, entry] of ov.pageToEntry) {
        const f = ov.fetched.get(entry);
        if (!f) continue;
        if (pagePath !== entry) delete files[pagePath];
        files[entry] = f;
      }
      await db.volume_files.put({ volume_uuid: uuid, files });
    }
    dropOverlay(uuid);
    await db.volumes.update(uuid, { missing_pages: absent.length, missing_page_paths: absent });
    if (cache)
      for (const [, entry] of pending.pages)
        await cache.delete(cacheKey(uuid, entry)).catch(() => {});
    forget(uuid);
    setStatus(uuid, { done: total, total, state: 'complete' });
    setTimeout(() => setStatus(uuid, null), 4000);
  } catch (e) {
    console.warn('[stream] background fill stopped:', e);
    const s = get(streamStatus)[uuid];
    setStatus(uuid, {
      done: s?.done ?? 0,
      total: s?.total ?? 0,
      state: 'paused',
      error: String((e as Error).message ?? e)
    });
  } finally {
    active.delete(`fill:${uuid}`);
  }
}

/** Update the volume row so the reader reloads (missing pages shrink → new pages appear). */
async function touchRow(uuid: string, stillMissing: string[]): Promise<void> {
  await db.volumes.update(uuid, {
    missing_pages: stillMissing.length,
    missing_page_paths: stillMissing
  });
}

function forget(uuid: string): void {
  const p = readPending();
  delete p[uuid];
  writePending(p);
}

/** Resume: called by streaming/resume.ts whenever the reader opens a volume. */
export function resumeIfPending(v: VolumeMetadata | undefined): void {
  const uuid = v?.volume_uuid;
  if (!uuid) return;
  const pending = readPending()[uuid];
  if (!pending) return;
  if (!v?.missing_pages) {
    forget(uuid);
    return;
  }
  if (!getOverlay(uuid))
    setOverlay(uuid, { pageToEntry: new Map(pending.pages), fetched: new Map() });
  void fill(uuid);
}

export function streamingSupported(): boolean {
  return typeof DecompressionStream !== 'undefined' && typeof fetch !== 'undefined';
}

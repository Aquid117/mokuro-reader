<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    pendingOpens,
    untrackOpen,
    markOpenFailed,
    type PendingOpen
  } from '$lib/streaming/open-tracker';
  import { progressTrackerStore } from '$lib/util/progress-tracker';
  import { db } from '$lib/catalog/db';
  import { needsDownload } from '$lib/catalog/volume-state';
  import { nav, routeParams } from '$lib/util/hash-router';
  import { downloadQueue } from '$lib/util/download-queue';

  /**
   * manga-immersion fork: visible feedback after tapping a cloud volume. Shows the download's progress
   * immediately and opens the reader when the volume is installed (unless the user went somewhere else).
   */
  let opens = $derived($pendingOpens);

  function processFor(p: PendingOpen) {
    return $progressTrackerStore.processes.find((x) => x.id === `download-${p.fileId}`);
  }

  const mb = (n?: number) => (n ? (n / 1048576).toFixed(0) : '0');

  async function findInstalled(p: PendingOpen) {
    const byUuid = await db.volumes.get(p.uuid);
    if (byUuid && !needsDownload(byUuid)) return byUuid;
    const all = await db.volumes.toArray();
    return all.find((v) => v.volume_title === p.title && !needsDownload(v)) ?? null;
  }

  const timer = setInterval(async () => {
    for (const p of $pendingOpens) {
      if (p.error) continue;
      const row = await findInstalled(p);
      if (row) {
        untrackOpen(p.uuid);
        // open only if the user is still on a catalog/series page (did not navigate into another volume)
        if (!$routeParams.volume) nav.toReader(p.seriesId || row.series_title, row.volume_uuid);
        continue;
      }
      const proc = processFor(p);
      if (proc && /error|failed/i.test(proc.status ?? ''))
        markOpenFailed(p.uuid, proc.status ?? 'Download failed');
      else if (!proc && Date.now() - p.startedAt > 90_000)
        markOpenFailed(p.uuid, 'Download did not start');
    }
  }, 800);
  onDestroy(() => clearInterval(timer));

  async function retry(p: PendingOpen) {
    untrackOpen(p.uuid);
    const row = await db.volumes.get(p.uuid);
    if (row) {
      downloadQueue.queueVolume(row);
      pendingOpens.update((all) => [...all, { ...p, error: undefined, startedAt: Date.now() }]);
    }
  }
</script>

{#if opens.length}
  <div
    class="fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4"
    role="status"
    aria-live="polite"
  >
    {#each opens as p (p.uuid)}
      {@const proc = processFor(p)}
      <div
        class="w-full max-w-md rounded-xl bg-gray-900/95 p-3 text-sm text-gray-100 shadow-2xl ring-1 ring-gray-700"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate font-medium">{p.title}</div>
            <div class="text-xs text-gray-400">
              {#if p.error}
                <span class="text-red-400">{p.error}</span>
              {:else if proc && proc.progress > 0}
                Downloading… {Math.round(proc.progress)}%{proc.totalBytes
                  ? ` · ${mb(proc.bytesLoaded)} / ${mb(proc.totalBytes)} MB`
                  : ''} — opens when ready
              {:else}
                Preparing download… the volume opens when it is ready
              {/if}
            </div>
          </div>
          {#if p.error}
            <div class="flex shrink-0 gap-2">
              <button class="rounded bg-primary-600 px-3 py-1 text-white" onclick={() => retry(p)}
                >Retry</button
              >
              <button class="rounded bg-gray-700 px-3 py-1" onclick={() => untrackOpen(p.uuid)}
                >Close</button
              >
            </div>
          {:else}
            <button
              class="shrink-0 rounded bg-gray-700 px-2 py-1 text-xs"
              onclick={() => untrackOpen(p.uuid)}
              title="Keep downloading, do not open automatically">Hide</button
            >
          {/if}
        </div>
        {#if !p.error}
          <div class="mt-2 h-1.5 overflow-hidden rounded bg-gray-700">
            {#if proc && proc.progress > 0}
              <div
                class="h-full bg-primary-500 transition-all"
                style:width={`${Math.min(100, proc.progress)}%`}
              ></div>
            {:else}
              <div class="h-full w-1/3 animate-pulse bg-primary-500/60"></div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

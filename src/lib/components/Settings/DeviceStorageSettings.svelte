<script lang="ts">
  import { AccordionItem, Toggle, Button, Helper } from 'flowbite-svelte';
  import { onMount } from 'svelte';
  import { settings, updateSetting } from '$lib/settings';
  import { defaultStorageSettings } from '$lib/settings/settings';
  import {
    findCleanupCandidates,
    runStorageCleanup,
    lastCleanup,
    type CleanupCandidate
  } from '$lib/immersion/storage-cleanup';
  import { showSnackbar } from '$lib/util/snackbar';

  // manga-immersion fork: device storage overview + automatic removal of finished volumes

  let cfg = $derived($settings.storage ?? defaultStorageSettings);
  let usage = $state<{ used: number; quota: number } | null>(null);
  let persisted = $state<boolean | null>(null);
  let candidates = $state<CleanupCandidate[] | null>(null);
  let busy = $state(false);

  const dayOptions = [0, 1, 3, 7, 14, 30];

  function gb(bytes: number): string {
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
  }

  async function refresh() {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage !== undefined && est.quota) usage = { used: est.usage, quota: est.quota };
      persisted = (await navigator.storage?.persisted?.()) ?? null;
    } catch {
      usage = null;
    }
    candidates = await findCleanupCandidates(cfg.afterDays).catch(() => null);
  }

  onMount(() => {
    void refresh();
  });

  async function freeNow() {
    busy = true;
    try {
      const n = await runStorageCleanup({ force: true });
      showSnackbar(
        n === null
          ? 'Server list not loaded yet, try again in a moment'
          : n === 0
            ? 'Nothing to remove'
            : `Removed ${n} finished volume${n === 1 ? '' : 's'} from this device`
      );
      await refresh();
    } finally {
      busy = false;
    }
  }

  function setDays(days: number) {
    updateSetting('storage', { ...cfg, afterDays: days });
    void findCleanupCandidates(days).then((c) => (candidates = c));
  }
</script>

<AccordionItem>
  {#snippet header()}Device storage{/snippet}
  <div class="flex flex-col gap-3">
    {#if usage}
      <div class="text-sm">
        This device: {gb(usage.used)} used of {gb(usage.quota)} available to the reader
        {#if persisted === false}
          <span class="text-amber-500">· may be cleared by the browser when space runs low</span>
        {:else if persisted}
          <span class="text-gray-500">· protected from automatic clearing</span>
        {/if}
      </div>
    {/if}

    <Toggle
      checked={cfg.autoRemoveFinished}
      onchange={() =>
        updateSetting('storage', { ...cfg, autoRemoveFinished: !cfg.autoRemoveFinished })}
    >
      Remove finished volumes from this device automatically
    </Toggle>
    <label class="flex items-center justify-between gap-2 text-sm">
      After finishing
      <select
        class="w-48 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
        value={cfg.afterDays}
        onchange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}
      >
        {#each dayOptions as d (d)}
          <option value={d}>{d === 0 ? 'right away' : `${d} day${d === 1 ? '' : 's'}`}</option>
        {/each}
      </select>
    </label>
    <Helper>
      Only volumes that are also on the server are removed. Progress, stats and the cover stay;
      tapping the volume downloads it again. Volumes downloaded but not finished are never removed.
    </Helper>

    <div class="flex items-center justify-between gap-2 text-sm">
      <span>
        {#if candidates === null}
          Server list not loaded yet.
        {:else if candidates.length === 0}
          Nothing to remove right now.
        {:else}
          {candidates.length} finished volume{candidates.length === 1 ? '' : 's'} can be removed now.
        {/if}
        {#if $lastCleanup}
          <span class="text-gray-500"
            >Last cleanup {new Date($lastCleanup.at).toLocaleString()}: {$lastCleanup.removed} removed.</span
          >
        {/if}
      </span>
      <Button
        size="xs"
        color="alternative"
        disabled={busy || !candidates?.length}
        onclick={freeNow}
      >
        {busy ? 'Removing…' : 'Free space now'}
      </Button>
    </div>

    <div
      class="flex items-center justify-between gap-2 border-t border-gray-200 pt-3 text-sm dark:border-gray-700"
    >
      <span>Server trash: volumes and series deleted from Bunko, restorable for 30 days.</span>
      <Button size="xs" color="alternative" onclick={() => (window.location.hash = '#/trash')}
        >Open</Button
      >
    </div>
  </div>
</AccordionItem>

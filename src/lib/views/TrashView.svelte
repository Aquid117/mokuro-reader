<script lang="ts">
  import { onMount } from 'svelte';
  import { Spinner } from 'flowbite-svelte';
  import { trashApi, restoreFromTrash, type TrashEntry } from '$lib/library/server-trash';
  import { promptConfirmation, showSnackbar } from '$lib/util';

  /**
   * manga-immersion fork: volumes and series deleted from the Bunko library. They stay here for 30 days,
   * can be restored (back into the library, then they show up again on all devices) or deleted for good.
   */
  let entries = $state<TrashEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      entries = (await trashApi.list()).entries;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  onMount(load);

  const size = (b: number) =>
    b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`;
  const daysLeft = (e: TrashEntry) =>
    Math.max(0, Math.ceil((e.expiresAt - Date.now()) / 86_400_000));
  const label = (e: TrashEntry) =>
    e.kind === 'series' ? `${e.series} (whole series, ${e.volumes.length} volumes)` : e.volumes[0];

  async function restore(e: TrashEntry) {
    busy = e.id;
    try {
      await restoreFromTrash(e.id);
      showSnackbar(`Restored ${label(e)}`);
      await load();
    } catch (err) {
      showSnackbar(`Could not restore: ${(err as Error).message}`);
    } finally {
      busy = null;
    }
  }

  function purge(e: TrashEntry) {
    promptConfirmation(`Delete “${label(e)}” permanently? This cannot be undone.`, async () => {
      busy = e.id;
      try {
        await trashApi.purge(e.id);
        await load();
      } catch (err) {
        showSnackbar(`Could not delete: ${(err as Error).message}`);
      } finally {
        busy = null;
      }
    });
  }

  function purgeAll() {
    promptConfirmation(
      `Empty the server trash (${entries.length} items, ${size(entries.reduce((n, e) => n + e.bytes, 0))})? This cannot be undone.`,
      async () => {
        for (const e of entries) await trashApi.purge(e.id).catch(() => {});
        await load();
      }
    );
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-4">
  <div class="flex items-center justify-between gap-2">
    <h1 class="text-xl font-semibold">Server trash</h1>
    {#if entries.length}
      <button
        class="rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-600"
        onclick={purgeAll}>Empty trash</button
      >
    {/if}
  </div>
  <p class="text-sm text-gray-500 dark:text-gray-400">
    Volumes and series deleted from the Bunko library. They are kept for 30 days, then deleted
    automatically. Restoring puts them back into the library for all devices; your progress and
    stats were never removed.
  </p>
  {#if loading}
    <div class="flex justify-center"><Spinner size="6" /></div>
  {:else if error}
    <p class="text-sm text-red-500">{error}</p>
  {:else if entries.length === 0}
    <p class="text-sm text-gray-500">The trash is empty.</p>
  {:else}
    <ul class="divide-y divide-gray-200 dark:divide-gray-700">
      {#each entries as e (e.id)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <div class="min-w-0 flex-1">
            <div class="font-medium break-words">{label(e)}</div>
            <div class="text-xs text-gray-500">
              {e.kind === 'volume' ? `${e.series} · ` : ''}{size(e.bytes)} · deleted {new Date(
                e.deletedAt
              ).toLocaleDateString()} · {daysLeft(e)} days left
            </div>
          </div>
          <button
            class="rounded bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            disabled={busy === e.id}
            onclick={() => restore(e)}>{busy === e.id ? '…' : 'Restore'}</button
          >
          <button
            class="rounded bg-gray-200 px-3 py-1.5 text-sm hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600"
            disabled={busy === e.id}
            onclick={() => purge(e)}>Delete now</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</div>

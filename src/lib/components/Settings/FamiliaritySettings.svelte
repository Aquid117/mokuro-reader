<script lang="ts">
  import { AccordionItem, Toggle, Label, Range, Button, Helper } from 'flowbite-svelte';
  import { settings, updateFamiliaritySetting, defaultFamiliaritySettings } from '$lib/settings';
  import {
    familiarityApi,
    familiarityWarning,
    invalidate,
    highlightsSupported
  } from '$lib/familiarity';
  import { showSnackbar } from '$lib/util/snackbar';
  import {
    ankiSync,
    refreshAnkiSync,
    syncAnkiNow,
    describeAnkiSync
  } from '$lib/familiarity/anki-sync';
  import { onMount } from 'svelte';

  let now = $state(Date.now());
  onMount(() => {
    void refreshAnkiSync();
    const t = setInterval(() => {
      now = Date.now();
      void refreshAnkiSync();
    }, 30_000);
    return () => clearInterval(t);
  });

  async function syncNow() {
    const err = await syncAnkiNow();
    now = Date.now();
    showSnackbar(err ? `AnkiWeb sync failed: ${err}` : 'Anki synced with AnkiWeb', 4000);
  }

  let fam = $derived($settings.familiarity ?? defaultFamiliaritySettings);
  let supported = $derived(typeof window !== 'undefined' && highlightsSupported());
  let refreshing = $state(false);

  const states: { key: 'new' | 'young' | 'due' | 'learning' | 'mined'; label: string }[] = [
    { key: 'new', label: 'New / unknown' },
    { key: 'young', label: 'Young (learning in Jiten)' },
    { key: 'due', label: 'Due for review' },
    { key: 'learning', label: 'Marked “learning” by me' },
    { key: 'mined', label: 'Already mined (underline)' }
  ];

  function setColor(key: (typeof states)[number]['key'], value: string) {
    updateFamiliaritySetting('colors', { ...fam.colors, [key]: value });
    invalidate();
  }

  async function refreshStates() {
    refreshing = true;
    try {
      const r = await familiarityApi.refresh();
      invalidate();
      showSnackbar(`Refreshed ${r.refreshed} vocabulary states from Jiten`);
    } catch (e) {
      showSnackbar(`Refresh failed: ${(e as Error).message}`);
    } finally {
      refreshing = false;
    }
  }
</script>

<AccordionItem>
  {#snippet header()}
    <span>Familiarity highlighting</span>
  {/snippet}
  <div class="flex flex-col gap-4">
    <Helper>
      Colours words in the OCR text by how well you know them, using your Jiten vocabulary states
      (fetched through this server; your API key stays on the server). Highlights are painted with
      CSS Custom Highlights, so dictionary pop-ups and text selection keep working.
    </Helper>
    {#if !supported}
      <Helper color="red"
        >This browser does not support the CSS Custom Highlight API (needs Safari 17.2+ / Chrome
        105+).</Helper
      >
    {/if}
    {#if $familiarityWarning}
      <Helper color="red">{$familiarityWarning}</Helper>
    {/if}

    <Toggle
      checked={fam.enabled}
      onchange={() => updateFamiliaritySetting('enabled', !fam.enabled)}
    >
      Enable familiarity highlighting
    </Toggle>
    <Toggle
      checked={fam.onlyUnknown}
      onchange={() => {
        updateFamiliaritySetting('onlyUnknown', !fam.onlyUnknown);
        invalidate();
      }}
    >
      Highlight unknown words only
    </Toggle>
    <Toggle
      checked={fam.showMined}
      onchange={() => {
        updateFamiliaritySetting('showMined', !fam.showMined);
        invalidate();
      }}
    >
      Underline words already in Anki
    </Toggle>
    <Toggle
      checked={fam.background}
      onchange={() => updateFamiliaritySetting('background', !fam.background)}
    >
      Tint the background behind words
    </Toggle>
    {#if fam.background}
      <div>
        <Label>Tint intensity ({Math.round(fam.intensity * 100)}%)</Label>
        <Range
          min={5}
          max={80}
          value={Math.round(fam.intensity * 100)}
          onchange={(e) =>
            updateFamiliaritySetting(
              'intensity',
              Number((e.target as HTMLInputElement).value) / 100
            )}
        />
      </div>
    {/if}
    <div>
      <Label>Skip very common words (frequency rank better than)</Label>
      <input
        type="number"
        min="0"
        step="100"
        class="mt-1 w-32 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
        value={fam.minFrequencyRank}
        onchange={(e) => {
          updateFamiliaritySetting(
            'minFrequencyRank',
            Math.max(0, Number((e.target as HTMLInputElement).value) || 0)
          );
          invalidate();
        }}
      />
      <Helper>0 = off. Example: 500 hides highlights on the 500 most frequent words.</Helper>
    </div>

    <div class="flex flex-col gap-2 rounded border border-gray-300 p-2 dark:border-gray-600">
      <Label>Mining from the word popup</Label>
      <Toggle
        checked={fam.mining.oneTap}
        onchange={() =>
          updateFamiliaritySetting('mining', { ...fam.mining, oneTap: !fam.mining.oneTap })}
      >
        One tap: create the card directly (no editor)
      </Toggle>
      <label class="flex items-center justify-between gap-2 text-sm">
        Deck
        <input
          class="w-48 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
          value={fam.mining.deck}
          onchange={(e) =>
            updateFamiliaritySetting('mining', {
              ...fam.mining,
              deck: (e.target as HTMLInputElement).value.trim() || 'Manga Mining'
            })}
        />
      </label>
      <label class="flex items-center justify-between gap-2 text-sm">
        Note type
        <input
          class="w-48 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
          value={fam.mining.model}
          onchange={(e) =>
            updateFamiliaritySetting('mining', {
              ...fam.mining,
              model: (e.target as HTMLInputElement).value.trim() || 'Manga Mining'
            })}
        />
      </label>
      <label class="flex items-center justify-between gap-2 text-sm">
        Card image
        <select
          class="w-48 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
          value={fam.mining.image}
          onchange={(e) =>
            updateFamiliaritySetting('mining', {
              ...fam.mining,
              image: (e.target as HTMLSelectElement).value as 'panel' | 'bubble' | 'page'
            })}
        >
          <option value="panel">Panel around the bubble</option>
          <option value="bubble">Just the speech bubble</option>
          <option value="page">Full page</option>
        </select>
      </label>
      <div class="flex items-center justify-between gap-2 text-sm">
        <span>
          AnkiWeb: {describeAnkiSync($ankiSync.status, now)}
        </span>
        <Button size="xs" color="alternative" disabled={$ankiSync.syncing} onclick={syncNow}>
          {$ankiSync.syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
      <Helper>
        New cards are synced automatically about {Math.max(
          1,
          Math.round(($ankiSync.status?.autoSync?.afterMiningSec ?? 120) / 60)
        )} min after the last added card, and every {Math.round(
          ($ankiSync.status?.autoSync?.intervalMin ?? 360) / 60
        )} h. Then sync AnkiMobile/Anki on your devices to see them.
      </Helper>
    </div>

    <div class="grid grid-cols-2 gap-2">
      {#each states as st (st.key)}
        <label class="flex items-center gap-2 text-sm">
          <input
            type="color"
            value={fam.colors[st.key]}
            onchange={(e) => setColor(st.key, (e.target as HTMLInputElement).value)}
          />
          {st.label}
        </label>
      {/each}
    </div>

    <div class="flex gap-2">
      <Button size="xs" color="alternative" disabled={refreshing} onclick={refreshStates}>
        {refreshing ? 'Refreshing…' : 'Refresh states from Jiten'}
      </Button>
      <Button
        size="xs"
        color="alternative"
        onclick={() => {
          updateFamiliaritySetting('colors', { ...defaultFamiliaritySettings.colors });
          invalidate();
        }}
      >
        Reset colours
      </Button>
    </div>
  </div>
</AccordionItem>

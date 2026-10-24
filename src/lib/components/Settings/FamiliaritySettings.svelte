<script lang="ts">
  import { AccordionItem, Toggle, Label, Range, Button, Helper } from 'flowbite-svelte';
  import {
    settings,
    updateFamiliaritySetting,
    defaultFamiliaritySettings,
    updateSetting
  } from '$lib/settings';
  import { defaultAiSettings } from '$lib/settings/settings';
  import { aiStatus, refreshAiStatus } from '$lib/ai/store';
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
  let ai = $derived($settings.ai ?? defaultAiSettings);

  // Jiten follows Anki: status + manual run
  type AnkiImport = Awaited<ReturnType<typeof familiarityApi.ankiImportStatus>>;
  let ankiImport = $state<AnkiImport | null>(null);
  let importing = $state(false);
  async function loadAnkiImport() {
    ankiImport = await familiarityApi.ankiImportStatus().catch(() => null);
  }
  async function runAnkiImport() {
    importing = true;
    try {
      const r = await familiarityApi.runAnkiImport(false);
      showSnackbar(r.ok ? `Jiten updated from Anki (${r.cards} cards)` : `Failed: ${r.error}`);
    } catch (e) {
      showSnackbar(`Failed: ${(e as Error).message}`);
    } finally {
      importing = false;
      await loadAnkiImport();
    }
  }

  onMount(() => {
    void refreshAnkiSync();
    void refreshAiStatus();
    void loadAnkiImport();
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
      Tint the background behind words (also on the page with the OCR text hidden)
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
    <div class="flex flex-col gap-2 rounded border border-gray-300 p-2 dark:border-gray-600">
      <Toggle
        checked={fam.furigana?.enabled ?? true}
        onchange={() =>
          updateFamiliaritySetting('furigana', {
            ...(fam.furigana ?? defaultFamiliaritySettings.furigana),
            enabled: !(fam.furigana?.enabled ?? true)
          })}
      >
        Furigana (shown with the OCR text)
      </Toggle>
      <label class="flex items-center justify-between gap-2 text-sm">
        For
        <select
          class="w-56 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
          value={fam.furigana?.scope ?? 'learning'}
          onchange={(e) =>
            updateFamiliaritySetting('furigana', {
              ...(fam.furigana ?? defaultFamiliaritySettings.furigana),
              scope: (e.target as HTMLSelectElement).value as 'new' | 'learning' | 'all'
            })}
        >
          <option value="new">Only new words</option>
          <option value="learning">New + learning words</option>
          <option value="all">All words with kanji</option>
        </select>
      </label>
      <Helper>Quick on/off: the あ button in the ＋ menu. Ignored words (names) get none.</Helper>
    </div>
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
      <Toggle
        checked={fam.mining.preview !== false}
        onchange={() =>
          updateFamiliaritySetting('mining', {
            ...fam.mining,
            preview: fam.mining.preview === false
          })}
      >
        Preview the card image first (adjust, then add)
      </Toggle>
      <Toggle
        checked={fam.mining.aiNotes !== false}
        onchange={() =>
          updateFamiliaritySetting('mining', {
            ...fam.mining,
            aiNotes: fam.mining.aiNotes === false
          })}
      >
        Add the bubble's AI explanation to the card's Notes (if it was explained)
      </Toggle>
      <label class="flex items-center justify-between gap-2 text-sm">
        Deck
        <input
          class="w-48 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
          value={fam.mining.deck}
          onchange={(e) =>
            updateFamiliaritySetting('mining', {
              ...fam.mining,
              deck: (e.target as HTMLInputElement).value.trim() || '4 Mining'
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

    {#if ankiImport}
      <div class="flex flex-col gap-1 rounded border border-gray-300 p-2 dark:border-gray-600">
        <div class="flex items-center justify-between gap-2">
          <Label>Jiten follows your Anki reviews</Label>
          <Button size="xs" color="alternative" disabled={importing} onclick={runAnkiImport}>
            {importing ? 'Updating…' : 'Update now'}
          </Button>
        </div>
        <Helper>
          Decks: {ankiImport.decks.join(', ')}. Runs after AnkiWeb syncs (weekly in full).
          {#if ankiImport.lastOkAt}
            Last update {new Date(ankiImport.lastOkAt).toLocaleString()}: {ankiImport.lastCards} cards.
          {/if}
          {#if ankiImport.lastError}<span class="text-red-500"
              >Last attempt failed: {ankiImport.lastError}</span
            >{/if}
        </Helper>
      </div>
    {/if}

    <div class="flex flex-col gap-2 rounded border border-gray-300 p-2 dark:border-gray-600">
      <Label>AI help (explain a bubble)</Label>
      <Toggle
        checked={ai.enabled}
        onchange={() => updateSetting('ai', { ...ai, enabled: !ai.enabled })}
      >
        Show "Explain" (+ menu, word popup, text box picker)
      </Toggle>
      <Toggle
        checked={ai.includeImage}
        onchange={() => updateSetting('ai', { ...ai, includeImage: !ai.includeImage })}
      >
        Send the panel image by default (better context, costs more)
      </Toggle>
      <label class="flex items-center justify-between gap-2 text-sm">
        Provider
        <select
          class="w-56 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
          value={ai.provider}
          onchange={(e) =>
            updateSetting('ai', {
              ...ai,
              provider: (e.target as HTMLSelectElement).value as typeof ai.provider
            })}
        >
          <option value="auto">Server default</option>
          {#each $aiStatus?.providers ?? [] as pr (pr.id)}
            <option value={pr.id} disabled={!pr.configured}
              >{pr.label}{pr.billing === 'subscription' ? '' : ' (pay per use)'}{pr.configured
                ? ''
                : ' (not set up)'}</option
            >
          {/each}
        </select>
      </label>
      <label class="flex items-center justify-between gap-2 text-sm">
        Default depth
        <select
          class="w-56 rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
          value={ai.quality}
          onchange={(e) =>
            updateSetting('ai', {
              ...ai,
              quality: (e.target as HTMLSelectElement).value as typeof ai.quality
            })}
        >
          <option value="fast">Fast</option>
          <option value="thorough">In depth (slower)</option>
        </select>
      </label>
      <Helper>
        {#if $aiStatus === null}
          AI status unavailable.
        {:else if !$aiStatus.configured}
          Not configured on the server (see docs/ai-help.md).
        {:else}
          {@const def = $aiStatus.providers.find(
            (pr) => pr.id === (ai.provider === 'auto' ? $aiStatus.defaultProvider : ai.provider)
          )}
          {#if def}Models: {def.models.fast} (fast), {def.models.thorough} (in depth).{/if}
          Today {$aiStatus.today.requests}/{$aiStatus.dailyLimit} requests. Only the bubble text, its
          neighbours, the title and (if chosen) the panel image are sent to the provider.
        {/if}
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

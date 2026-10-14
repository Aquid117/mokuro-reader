<script lang="ts">
  import { onMount } from 'svelte';
  import { Input, Spinner } from 'flowbite-svelte';
  import { familiarityApi, type MarkedWord, type SeriesIgnore } from '$lib/familiarity/api';
  import { invalidate } from '$lib/familiarity/engine';
  import { showSnackbar } from '$lib/util';

  /**
   * manga-immersion fork: every word marked in the reader. "Known" is mirrored to Jiten (Never forget)
   * and shows its sync status; "Learning" is reader-only; ignores are per series (names, sound effects)
   * and never leave the reader. Everything here can be undone or changed.
   */
  type Tab = 'known' | 'learning' | 'ignored';
  let tab = $state<Tab>('known');
  let query = $state('');
  let seriesFilter = $state('');
  let marks = $state<MarkedWord[]>([]);
  let ignores = $state<SeriesIgnore[]>([]);
  let seriesCounts = $state<{ series: string; n: number }[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  function readHashParams() {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const series = q.get('series');
    if (series) {
      seriesFilter = series;
      tab = 'ignored';
    }
  }

  async function load() {
    const mine = ++seq;
    loading = true;
    error = null;
    try {
      if (tab === 'ignored') {
        const res = await familiarityApi.listSeriesIgnores(seriesFilter || undefined, query);
        if (mine !== seq) return;
        ignores = res.ignores;
        seriesCounts = res.series;
        // legacy global ignores (made before ignores were per series) are listed as "all series"
        const legacy = await familiarityApi.listOverrides('ignore', query);
        if (mine !== seq) return;
        if (!seriesFilter)
          ignores = [
            ...legacy.overrides.map((m) => ({
              series: '',
              wordId: m.wordId,
              readingIndex: m.readingIndex,
              spelling: m.spelling,
              reading: m.reading,
              meaning: m.meaning,
              createdAt: m.updatedAt
            })),
            ...ignores
          ];
      } else {
        const res = await familiarityApi.listOverrides(tab, query);
        if (mine !== seq) return;
        marks = res.overrides;
      }
    } catch (e) {
      if (mine === seq) error = (e as Error).message;
    } finally {
      if (mine === seq) loading = false;
    }
  }

  onMount(() => {
    readHashParams();
    void load();
  });

  function setTab(t: Tab) {
    tab = t;
    void load();
  }

  function onInput() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void load(), 250);
  }

  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      invalidate();
      showSnackbar(message);
      await load();
    } catch (e) {
      showSnackbar(`Could not save: ${(e as Error).message}`);
    }
  }

  const reset = (m: MarkedWord) =>
    act(
      () => familiarityApi.clearOverride(m.wordId, m.readingIndex),
      m.state === 'known' ? 'Unmarked (also removed in Jiten)' : 'Unmarked'
    );
  const switchTo = (m: MarkedWord, state: 'known' | 'learning') =>
    act(
      () =>
        familiarityApi.setOverride(m.wordId, m.readingIndex, state, {
          spelling: m.spelling ?? undefined,
          reading: m.reading ?? undefined,
          meaning: m.meaning ?? undefined
        }),
      state === 'known' ? 'Marked as known (also in Jiten)' : 'Marked as learning'
    );
  const unignore = (i: SeriesIgnore) =>
    act(
      () =>
        i.series
          ? familiarityApi.unignoreInSeries(i.series, i.wordId, i.readingIndex)
          : familiarityApi.clearOverride(i.wordId, i.readingIndex),
      'No longer ignored'
    );

  let grouped = $derived.by(() => {
    const out = new Map<string, SeriesIgnore[]>();
    for (const i of ignores) out.set(i.series, [...(out.get(i.series) ?? []), i]);
    return [...out.entries()];
  });

  function date(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  const syncLabel: Record<string, string> = {
    ok: '✓ in Jiten',
    pending: 'syncing to Jiten…',
    error: 'Jiten sync failed, retrying'
  };
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-4">
  <h1 class="text-xl font-semibold">Marked words</h1>
  <p class="text-sm text-gray-500 dark:text-gray-400">
    <b>Known</b> words are also marked "Never forget" in Jiten. <b>Learning</b> stays in the reader.
    <b>Ignored</b> words are per series (names, sound effects) and never go to Jiten. Anki is never changed.
  </p>

  <div
    class="flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600"
    role="tablist"
  >
    {#each [['known', 'Known'], ['learning', 'Learning'], ['ignored', 'Ignored by series']] as [key, label] (key)}
      <button
        role="tab"
        aria-selected={tab === key}
        class="flex-1 px-3 py-2 text-sm {tab === key
          ? 'bg-primary-600 text-white'
          : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700'}"
        onclick={() => setTab(key as Tab)}>{label}</button
      >
    {/each}
  </div>

  <div class="flex flex-wrap gap-2">
    <div class="min-w-0 flex-1">
      <Input bind:value={query} oninput={onInput} placeholder="Search word, reading or meaning…" />
    </div>
    {#if tab === 'ignored'}
      <select
        class="rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700"
        bind:value={seriesFilter}
        onchange={() => load()}
      >
        <option value="">All series</option>
        {#each seriesCounts as s (s.series)}
          <option value={s.series}>{s.series} ({s.n})</option>
        {/each}
      </select>
    {/if}
  </div>
  {#if error}<p class="text-sm text-red-500">{error}</p>{/if}

  {#if loading}
    <div class="flex justify-center"><Spinner size="6" /></div>
  {:else if tab !== 'ignored'}
    {#if marks.length === 0}
      <p class="text-sm text-gray-500">
        Nothing marked {tab === 'known' ? 'as known' : 'as learning'} yet.
      </p>
    {/if}
    <ul class="divide-y divide-gray-200 dark:divide-gray-700">
      {#each marks as m (`${m.wordId}:${m.readingIndex}`)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <div class="min-w-0 flex-1">
            <span class="text-lg">{m.spelling ?? `#${m.wordId}`}</span>
            {#if m.reading && m.reading !== m.spelling}<span class="ml-1 text-sm text-gray-500"
                >{m.reading}</span
              >{/if}
            {#if m.meaning}<div class="truncate text-sm text-gray-600 dark:text-gray-400">
                {m.meaning}
              </div>{/if}
          </div>
          <span class="text-xs text-gray-500">{date(m.updatedAt)}</span>
          {#if tab === 'known' && m.jitenSync}
            <span
              class="text-xs {m.jitenSync === 'error' ? 'text-red-500' : 'text-gray-500'}"
              title={m.jitenError ?? ''}>{syncLabel[m.jitenSync]}</span
            >
          {/if}
          <button
            class="rounded px-2 py-1 text-sm hover:bg-gray-200 dark:hover:bg-gray-700"
            onclick={() => switchTo(m, tab === 'known' ? 'learning' : 'known')}
            >{tab === 'known' ? '→ Learning' : '→ Known'}</button
          >
          <button
            class="rounded bg-gray-200 px-2 py-1 text-sm hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
            onclick={() => reset(m)}>Undo</button
          >
        </li>
      {/each}
    </ul>
  {:else}
    {#if ignores.length === 0}
      <p class="text-sm text-gray-500">
        No ignored words{seriesFilter ? ` in ${seriesFilter}` : ''}. In the reader: tap a word →
        "Ignore in series".
      </p>
    {/if}
    {#each grouped as [series, list] (series)}
      <section>
        <h2 class="mb-1 text-sm font-semibold text-gray-600 dark:text-gray-300">
          {series || 'All series (older ignores)'}
          <span class="font-normal text-gray-500">· {list.length}</span>
        </h2>
        <ul class="divide-y divide-gray-200 dark:divide-gray-700">
          {#each list as i (`${i.series}:${i.wordId}:${i.readingIndex}`)}
            <li class="flex items-center gap-3 py-1.5">
              <div class="min-w-0 flex-1">
                <span>{i.spelling ?? `#${i.wordId}`}</span>
                {#if i.reading && i.reading !== i.spelling}<span class="ml-1 text-sm text-gray-500"
                    >{i.reading}</span
                  >{/if}
                {#if i.meaning}<span class="ml-2 truncate text-sm text-gray-500">{i.meaning}</span
                  >{/if}
              </div>
              <button
                class="rounded bg-gray-200 px-2 py-1 text-sm hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
                onclick={() => unignore(i)}>Undo</button
              >
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

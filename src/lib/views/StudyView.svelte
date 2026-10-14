<script lang="ts">
  import { onMount } from 'svelte';
  import { Input, Spinner } from 'flowbite-svelte';
  import { currentView, nav } from '$lib/util/hash-router';
  import { studyApi, loadSeriesStudy, type StudyWord, type VolumeSummary } from '$lib/study/api';
  import { familiarityApi } from '$lib/familiarity/api';
  import { invalidate } from '$lib/familiarity/engine';
  import { readingToKana } from '$lib/familiarity/mining-context';
  import { quickMine } from '$lib/familiarity/quick-mine';
  import type { VocabEntry } from '$lib/familiarity/types';
  import { db } from '$lib/catalog/db';
  import { isVolumeInstalled } from '$lib/catalog/volume-state';
  import { matchFilesToPages } from '$lib/reader/image-cache';
  import { settings } from '$lib/settings';
  import { showSnackbar } from '$lib/util';

  /**
   * manga-immersion fork: pre-study a volume. Shows how much of its text you know and the words you
   * don't, most frequent first, with the first sentence they appear in. Mark them known (→ Jiten),
   * learning, ignore them for this series (names), or mine them into Anki with the page image.
   */
  let view = $derived($currentView);
  let series = $derived(view.type === 'study' ? view.seriesId : '');
  let volume = $derived(view.type === 'study' ? view.volumeId : '');

  let summary = $state<VolumeSummary | null>(null);
  let words = $state<StudyWord[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let filter = $state<'new' | 'learning' | 'both'>('new');
  let hideMined = $state(true);
  let minCount = $state(1);
  let query = $state('');
  let selected = $state<Set<string>>(new Set());
  let busyKey = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const key = (w: StudyWord) => `${w.wordId}:${w.readingIndex}`;

  async function load(quiet = false) {
    if (!series || !volume) return;
    if (!quiet) loading = true;
    error = null;
    try {
      const res = await studyApi.volume(series, volume);
      summary = res.summary;
      words = res.words;
      if (pollTimer) clearTimeout(pollTimer);
      if (res.summary.status === 'queued' || res.summary.status === 'running')
        pollTimer = setTimeout(() => void load(true), 4000);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    return () => {
      if (pollTimer) clearTimeout(pollTimer);
    };
  });

  let shown = $derived.by(() => {
    const ql = query.trim().toLowerCase();
    return words.filter(
      (w) =>
        (filter === 'both' || w.category === filter) &&
        (!hideMined || !w.mined) &&
        w.count >= minCount &&
        (!ql ||
          w.spelling.includes(ql) ||
          readingToKana(w.reading).includes(ql) ||
          w.meanings.some((m) => m.some((g) => g.toLowerCase().includes(ql))))
    );
  });

  let c = $derived(summary?.coverage ?? null);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  function info(w: StudyWord) {
    return {
      spelling: w.spelling,
      reading: readingToKana(w.reading),
      meaning: w.meanings[0]?.slice(0, 3).join('; ')
    };
  }

  function remove(keys: Set<string>) {
    words = words.filter((w) => !keys.has(key(w)));
    selected = new Set([...selected].filter((k) => !keys.has(k)));
    invalidate();
    void loadSeriesStudy(series); // badges in the series view
    setTimeout(() => void load(true), 800); // coverage numbers
  }

  async function mark(list: StudyWord[], action: 'known' | 'learning' | 'ignore') {
    try {
      for (const w of list) {
        if (action === 'ignore')
          await familiarityApi.ignoreInSeries(series, w.wordId, w.readingIndex, info(w));
        else await familiarityApi.setOverride(w.wordId, w.readingIndex, action, info(w));
      }
      if (action === 'learning') {
        for (const w of list) w.category = 'learning';
        words = [...words];
        invalidate();
      } else remove(new Set(list.map(key)));
      showSnackbar(
        `${list.length === 1 ? list[0].spelling : `${list.length} words`} ${
          action === 'known'
            ? 'marked as known (also in Jiten)'
            : action === 'ignore'
              ? `ignored in ${series}`
              : 'marked as learning'
        }`
      );
    } catch (e) {
      showSnackbar(`Could not save: ${(e as Error).message}`);
    }
  }

  /** The page image: from this device when the volume is downloaded, else from the server's CBZ. */
  async function pageImage(page: number): Promise<{ blob: Blob | null; uuid: string | null }> {
    const row = (await db.volumes.where('series_title').equals(series).toArray()).find(
      (v) => v.volume_title === volume
    );
    if (row && isVolumeInstalled(row)) {
      const [ocr, vf] = await Promise.all([
        db.volume_ocr.get(row.volume_uuid),
        db.volume_files.get(row.volume_uuid)
      ]);
      const file = ocr && vf ? matchFilesToPages(vf.files, ocr.pages)[page] : null;
      if (file) return { blob: file, uuid: row.volume_uuid };
    }
    const res = await fetch(studyApi.pageImageUrl(series, volume, page), {
      credentials: 'same-origin'
    });
    return { blob: res.ok ? await res.blob() : null, uuid: row?.volume_uuid ?? null };
  }

  async function mine(w: StudyWord) {
    if (!w.example) return;
    if (!$settings.ankiConnectSettings.enabled) {
      showSnackbar('Enable AnkiConnect in the settings first');
      return;
    }
    busyKey = key(w);
    try {
      const ex = w.example;
      const { blob, uuid } = await pageImage(ex.page);
      const vocab: VocabEntry = {
        spelling: w.spelling,
        reading: w.reading,
        meanings: w.meanings,
        pos: w.pos,
        freq: w.freq,
        pitch: w.pitch,
        jiten: w.jiten,
        override: (w.override as VocabEntry['override']) ?? null,
        mined: w.mined
      };
      const ok = await quickMine({
        token: { s: ex.s, e: ex.e, w: w.wordId, r: w.readingIndex, state: 'new' },
        vocab,
        surface: ex.text.slice(ex.s, ex.e),
        blockText: ex.text,
        imageBlob: blob,
        bubble: ex.box,
        pageSize: ex.pageSize,
        pageNumber: ex.page + 1,
        seriesTitle: series,
        volumeTitle: volume,
        sourceUrl: uuid
          ? `${location.origin}/#/reader/${encodeURIComponent(series)}/${encodeURIComponent(uuid)}`
          : location.href
      });
      if (ok) {
        w.mined = true;
        words = [...words];
      }
    } finally {
      busyKey = null;
    }
  }

  function toggle(w: StudyWord) {
    const k = key(w);
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    selected = next;
  }

  let selectedWords = $derived(words.filter((w) => selected.has(key(w))));

  function parts(w: StudyWord) {
    const ex = w.example!;
    return [ex.text.slice(0, ex.s), ex.text.slice(ex.s, ex.e), ex.text.slice(ex.e)];
  }
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-4 p-4">
  <div class="flex flex-wrap items-baseline gap-x-3">
    <button class="text-sm text-primary-500 hover:underline" onclick={() => nav.toSeries(series)}
      >← {series}</button
    >
    <h1 class="text-xl font-semibold">Study: {volume}</h1>
  </div>

  {#if loading}
    <div class="flex justify-center"><Spinner size="6" /></div>
  {:else if error}
    <p class="text-sm text-red-500">{error}</p>
  {:else if summary && summary.status !== 'done'}
    <p class="text-sm text-gray-500">
      {summary.status === 'error'
        ? `Analysis failed: ${summary.error ?? 'unknown error'} (retrying in a few minutes)`
        : 'Analysing this volume with Jiten… (about 10 s per volume)'}
    </p>
  {:else if c}
    <section class="flex flex-col gap-2">
      <div class="flex h-4 w-full overflow-hidden rounded bg-gray-700" aria-hidden="true">
        <div class="bg-green-600" style:width={pct(c.known - c.learning)}></div>
        <div class="bg-yellow-500" style:width={pct(c.learning)}></div>
        <div class="bg-purple-600" style:width={pct(c.new)}></div>
      </div>
      <p class="text-sm">
        <b>{pct(c.known)}</b> of the text is known or in review ({pct(c.learning)} still learning),
        <b>{c.uniqueNew}</b> new words ({pct(c.new)} of the text), {c.uniqueWords} different words in
        total.
        {c.label === 'easy'
          ? 'Comfortable to read.'
          : c.label === 'ok'
            ? 'Readable with some look-ups.'
            : 'Challenging: pre-studying the most frequent words helps a lot.'}
      </p>
    </section>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <div class="flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
        {#each [['new', 'New'], ['learning', 'Learning'], ['both', 'Both']] as [k, label] (k)}
          <button
            class="px-3 py-1.5 {filter === k
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700'}"
            onclick={() => (filter = k as typeof filter)}>{label}</button
          >
        {/each}
      </div>
      <label class="flex items-center gap-1"
        ><input type="checkbox" bind:checked={hideMined} /> hide words already in Anki</label
      >
      <label class="flex items-center gap-1"
        >appears at least
        <select
          class="rounded border-gray-300 py-1 text-sm dark:border-gray-600 dark:bg-gray-700"
          bind:value={minCount}
        >
          {#each [1, 2, 3, 5, 10] as n (n)}<option value={n}>{n}×</option>{/each}
        </select>
      </label>
      <div class="min-w-40 flex-1">
        <Input size="sm" bind:value={query} placeholder="Search…" />
      </div>
    </div>

    {#if selectedWords.length}
      <div
        class="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded bg-gray-800 px-3 py-2 text-sm text-white"
      >
        <span>{selectedWords.length} selected</span>
        <button
          class="rounded bg-green-700 px-2 py-1 hover:bg-green-600"
          onclick={() => mark(selectedWords, 'known')}>Mark known</button
        >
        <button
          class="rounded bg-gray-600 px-2 py-1 hover:bg-gray-500"
          onclick={() => mark(selectedWords, 'ignore')}>Ignore in series</button
        >
        <button class="ml-auto underline" onclick={() => (selected = new Set())}>Clear</button>
      </div>
    {/if}

    <p class="text-xs text-gray-500">
      {shown.length} words, most frequent in this volume first. Ignored words of {series} are hidden;
      manage them under Marked words.
    </p>
    <ul class="divide-y divide-gray-200 dark:divide-gray-700">
      {#each shown as w (key(w))}
        <li class="flex gap-3 py-2.5">
          <input
            type="checkbox"
            class="mt-1.5"
            checked={selected.has(key(w))}
            onchange={() => toggle(w)}
            aria-label="Select {w.spelling}"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="text-lg font-medium">{w.spelling}</span>
              {#if readingToKana(w.reading) !== w.spelling}<span class="text-gray-500"
                  >{readingToKana(w.reading)}</span
                >{/if}
              <span class="rounded bg-gray-200 px-1.5 text-xs dark:bg-gray-700">×{w.count}</span>
              {#if w.freq > 0}<span class="text-xs text-gray-500">freq #{w.freq}</span>{/if}
              {#if w.category === 'learning'}<span class="text-xs text-yellow-500">learning</span
                >{/if}
              {#if w.mined}<span class="text-xs text-green-500">in Anki</span>{/if}
            </div>
            <div class="text-sm text-gray-700 dark:text-gray-300">
              {w.meanings
                .slice(0, 2)
                .map((m) => m.slice(0, 3).join('; '))
                .join(' · ')}
            </div>
            {#if w.example}
              {@const [a, b, d] = parts(w)}
              <div class="mt-0.5 text-sm text-gray-500">
                {a}<b class="text-gray-900 dark:text-white">{b}</b>{d}
                <span class="text-xs">· p. {w.example.page + 1}</span>
              </div>
            {/if}
          </div>
          <div class="flex shrink-0 flex-col gap-1 text-xs sm:flex-row sm:items-start">
            <button
              class="rounded bg-green-700 px-2 py-1 text-white hover:bg-green-600"
              onclick={() => mark([w], 'known')}>Known</button
            >
            {#if w.category !== 'learning'}
              <button
                class="rounded bg-yellow-600 px-2 py-1 text-white hover:bg-yellow-500"
                onclick={() => mark([w], 'learning')}>Learning</button
              >
            {/if}
            <button
              class="rounded bg-gray-600 px-2 py-1 text-white hover:bg-gray-500"
              onclick={() => mark([w], 'ignore')}
              title="Names, sound effects: hidden in this series only, not sent to Jiten"
              >Ignore</button
            >
            {#if $settings.ankiConnectSettings.enabled && w.example && !w.mined}
              <button
                class="rounded bg-primary-600 px-2 py-1 text-white hover:bg-primary-700 disabled:opacity-50"
                disabled={busyKey === key(w)}
                onclick={() => mine(w)}>{busyKey === key(w) ? '…' : 'Add to Anki'}</button
              >
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

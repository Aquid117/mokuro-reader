<script lang="ts">
  import { onMount } from 'svelte';
  import { Input, Spinner } from 'flowbite-svelte';
  import { aiApi, type AiHistoryItem } from '$lib/ai/api';
  import { aiPanel, openStoredExplanation } from '$lib/ai/store';
  import { nav } from '$lib/util/hash-router';
  import { showSnackbar } from '$lib/util';

  /**
   * manga-immersion fork: every AI explanation is stored on the server per user; this page lists them
   * (newest first, searchable). Opening an entry shows it in the explanation panel with its follow-ups,
   * where more questions can be asked.
   */
  let items = $state<AiHistoryItem[]>([]);
  let next = $state<number | null>(null);
  let query = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);
  let confirmDelete = $state<string | null>(null);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  const providerNames: Record<string, string> = {
    codex: 'ChatGPT',
    gemini: 'Gemini',
    openai: 'OpenAI API'
  };

  async function load(reset: boolean) {
    const mine = ++seq;
    loading = true;
    error = null;
    try {
      const res = await aiApi.history({ before: reset ? null : next, q: query, limit: 30 });
      if (mine !== seq) return;
      items = reset ? res.items : [...items, ...res.items];
      next = res.next;
    } catch (e) {
      if (mine !== seq) return;
      error = (e as Error).message;
    } finally {
      if (mine === seq) loading = false;
    }
  }

  function onInput() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void load(true), 300);
  }

  onMount(() => {
    void load(true);
  });

  // refresh after follow-ups in the panel (counts and order change)
  let wasOpen = false;
  $effect(() => {
    const open = $aiPanel.open;
    if (wasOpen && !open) void load(true);
    wasOpen = open;
  });

  function parts(text: string, focus?: string): { t: string; focus: boolean }[] {
    if (!focus || !text.includes(focus)) return [{ t: text, focus: false }];
    const i = text.indexOf(focus);
    return [
      { t: text.slice(0, i), focus: false },
      { t: focus, focus: true },
      { t: text.slice(i + focus.length), focus: false }
    ];
  }

  function dayLabel(ts: number): string {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric'
    });
  }

  function time(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  let groups = $derived.by(() => {
    const out: { label: string; items: AiHistoryItem[] }[] = [];
    for (const it of items) {
      const label = dayLabel(it.lastAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(it);
      else out.push({ label, items: [it] });
    }
    return out;
  });

  function open(it: AiHistoryItem) {
    void openStoredExplanation(
      {
        ...it.context,
        seriesId: it.seriesId ?? undefined,
        volumeId: it.volumeId ?? undefined
      },
      it.explanationId
    );
  }

  async function remove(it: AiHistoryItem) {
    if (confirmDelete !== it.explanationId) {
      confirmDelete = it.explanationId;
      return;
    }
    confirmDelete = null;
    try {
      await aiApi.forget(it.explanationId);
      items = items.filter((x) => x.explanationId !== it.explanationId);
    } catch (e) {
      showSnackbar(`Could not delete: ${(e as Error).message}`);
    }
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-4">
  <h1 class="text-xl font-semibold">AI explanations</h1>
  <p class="text-sm text-gray-500 dark:text-gray-400">
    Every bubble you had explained, newest first. Tap one to read it again and ask follow-up
    questions. Stored on the server, so all your devices see the same history.
  </p>

  <Input
    bind:value={query}
    oninput={onInput}
    placeholder="Search Japanese, translation or title…"
  />
  {#if error}<p class="text-sm text-red-500">{error}</p>{/if}

  {#if !loading && items.length === 0 && !error}
    <p class="text-sm text-gray-500">
      {query.trim()
        ? 'Nothing found.'
        : 'No explanations yet. In the reader: + menu → 💡, or tap a word → Explain sentence.'}
    </p>
  {/if}

  {#each groups as g (g.label)}
    <section class="flex flex-col gap-2">
      <h2 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">{g.label}</h2>
      {#each g.items as it (it.explanationId)}
        <div
          class="rounded-lg border border-gray-300 bg-white/60 p-3 dark:border-gray-700 dark:bg-gray-800/60"
        >
          <button class="block w-full text-left" onclick={() => open(it)}>
            <div class="text-lg leading-snug break-words">
              {#each parts(it.text, it.context.focusWord) as part, i (i)}
                {#if part.focus}<strong class="text-primary-500">{part.t}</strong
                  >{:else}{part.t}{/if}
              {/each}
            </div>
            {#if it.translation}
              <div class="mt-1 text-sm text-gray-700 dark:text-gray-300">{it.translation}</div>
            {/if}
          </button>
          <div
            class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400"
          >
            <span>{time(it.lastAt)}</span>
            {#if it.context.series}
              <span
                >{it.context.series}{it.context.volume && it.context.volume !== it.context.series
                  ? ` · ${it.context.volume}`
                  : ''}{it.context.page ? ` · p. ${it.context.page}` : ''}</span
              >
            {/if}
            <span>{providerNames[it.provider] ?? it.provider} · {it.model}</span>
            {#if it.withImage}<span>with image</span>{/if}
            {#if it.followUps}<span>{it.followUps} follow-up{it.followUps === 1 ? '' : 's'}</span
              >{/if}
            <span class="ml-auto flex gap-1">
              {#if it.seriesId && it.volumeId}
                <button
                  class="rounded px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-700"
                  onclick={() => nav.toReader(it.seriesId!, it.volumeId!)}
                  title="Open the volume (at your current reading position)">Open volume</button
                >
              {/if}
              <button
                class="rounded px-2 py-1 {confirmDelete === it.explanationId
                  ? 'bg-red-600 text-white'
                  : 'hover:bg-gray-200 dark:hover:bg-gray-700'}"
                onclick={() => remove(it)}
                onblur={() => {
                  if (confirmDelete === it.explanationId) confirmDelete = null;
                }}>{confirmDelete === it.explanationId ? 'Delete?' : 'Delete'}</button
              >
            </span>
          </div>
        </div>
      {/each}
    </section>
  {/each}

  {#if loading}
    <div class="flex justify-center"><Spinner size="6" /></div>
  {:else if next}
    <button
      class="self-center rounded bg-gray-200 px-4 py-2 text-sm hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
      onclick={() => load(false)}>Load more</button
    >
  {/if}
</div>

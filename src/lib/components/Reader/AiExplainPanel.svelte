<script lang="ts">
  import { aiPanel, ask, closeExplain, reExplain } from '$lib/ai/store';
  import { renderMarkdown } from '$lib/ai/markdown';
  import type { ExplanationData } from '$lib/ai/api';
  import { showSnackbar } from '$lib/util/snackbar';
  import { familiarityApi } from '$lib/familiarity/api';
  import { ankiConnect } from '$lib/anki-connect';
  import { buildAiNotes, mergeAiNotes, hasAiNotes } from '$lib/ai/anki-notes';
  import { settings } from '$lib/settings';

  // manga-immersion fork: AI explanation of one speech bubble (translation, breakdown, grammar)
  // with follow-up questions. Non-modal: side panel on wide screens, bottom sheet on narrow ones.

  let question = $state('');
  let scroller: HTMLDivElement | undefined = $state();

  let p = $derived($aiPanel);
  let ex = $derived<ExplanationData | null>(p.result?.explanation ?? null);

  const providerNames: Record<string, string> = {
    codex: 'ChatGPT',
    gemini: 'Gemini',
    openai: 'OpenAI API'
  };

  // elapsed seconds while waiting (Codex answers take ~10 s, in-depth ~40 s)
  let now = $state(Date.now());
  $effect(() => {
    if (!p.loading && !p.asking) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  let elapsed = $derived(Math.max(0, Math.round((now - p.startedAt) / 1000)));

  // Cards mined from this bubble: offer to put the explanation into their Notes field
  interface CardRow {
    noteId: number;
    word: string;
    status: 'idle' | 'adding' | 'done' | 'has';
  }
  let cards = $state<CardRow[]>([]);
  let cardsFor = '';
  $effect(() => {
    const text = p.ctx?.text ?? '';
    const key = `${text}|${p.result?.id ?? ''}`;
    if (!p.result || !text || key === cardsFor || !$settings.ankiConnectSettings.enabled) return;
    cardsFor = key;
    cards = [];
    familiarityApi
      .minedForBubble(text)
      .then(async (res) => {
        const rows: CardRow[] = res.mined.map((m) => ({
          noteId: m.noteId,
          word: m.word ?? '?',
          status: 'idle'
        }));
        if (rows.length) {
          const info = (await ankiConnect(
            'notesInfo',
            { notes: rows.map((r) => r.noteId) },
            { silent: true }
          )) as { noteId: number; fields?: Record<string, { value: string }> }[] | undefined;
          for (const r of rows) {
            const n = info?.find((x) => x?.noteId === r.noteId);
            if (!n?.fields)
              r.status = 'done'; // deleted in Anki: nothing to update
            else if (hasAiNotes(n.fields.Notes?.value ?? '')) r.status = 'has';
          }
        }
        if (cardsFor === key) cards = rows.filter((r) => r.status !== 'done');
      })
      .catch(() => {});
  });

  async function addToCard(row: CardRow) {
    if (!ex) return;
    row.status = 'adding';
    try {
      const info = (await ankiConnect('notesInfo', { notes: [row.noteId] }, { silent: true })) as
        | { fields?: Record<string, { value: string }> }[]
        | undefined;
      const existing = info?.[0]?.fields?.Notes?.value ?? '';
      const merged = mergeAiNotes(existing, buildAiNotes(ex));
      await ankiConnect(
        'updateNoteFields',
        { note: { id: row.noteId, fields: { Notes: merged } } },
        { silent: true }
      );
      row.status = 'has';
      showSnackbar(`Explanation added to the card for ${row.word}`);
    } catch (e) {
      row.status = 'idle';
      showSnackbar(`Could not update the card: ${(e as Error).message}`);
    }
  }

  function sentenceParts(text: string, focus?: string): { t: string; focus: boolean }[] {
    if (!focus || !text.includes(focus)) return [{ t: text, focus: false }];
    const i = text.indexOf(focus);
    return [
      { t: text.slice(0, i), focus: false },
      { t: focus, focus: true },
      { t: text.slice(i + focus.length), focus: false }
    ];
  }

  // keep the newest follow-up in view while it streams
  $effect(() => {
    void p.streaming;
    void p.result?.messages.length;
    if (scroller && (p.asking || p.streaming)) scroller.scrollTop = scroller.scrollHeight;
  });

  async function submit(e: Event) {
    e.preventDefault();
    const q = question;
    if (!q.trim()) return;
    question = '';
    await ask(q);
  }

  function copy() {
    if (!ex || !p.ctx) return;
    const lines = [
      p.ctx.text,
      '',
      ex.translation,
      `Literal: ${ex.literal}`,
      ...ex.grammar.map((g) => `- ${g.pattern}: ${g.explanation}`)
    ];
    navigator.clipboard?.writeText(lines.join('\n')).then(
      () => showSnackbar('Explanation copied'),
      () => showSnackbar('Copy failed')
    );
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && $aiPanel.open) {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
      e.stopPropagation();
      closeExplain();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if p.open && p.ctx}
  <div
    class="fixed inset-x-0 bottom-0 z-[55] flex h-[62vh] flex-col border-t border-gray-700 bg-gray-900/97 text-gray-100 shadow-2xl backdrop-blur lg:inset-y-0 lg:right-0 lg:left-auto lg:h-auto lg:w-[420px] lg:border-t-0 lg:border-l"
    role="complementary"
    aria-label="AI explanation"
    data-ai-panel
  >
    <div class="flex items-start gap-2 border-b border-gray-700 px-4 pt-3 pb-2">
      <div class="min-w-0 flex-1">
        <div class="text-xs tracking-wide text-gray-400 uppercase">Explain</div>
        <div class="text-lg leading-snug break-words">
          {#each sentenceParts(p.ctx.text, p.ctx.focusWord) as part, i (i)}
            {#if part.focus}<strong class="text-primary-300">{part.t}</strong>{:else}{part.t}{/if}
          {/each}
        </div>
      </div>
      <button
        class="rounded px-2 py-1 text-gray-400 hover:bg-gray-700 hover:text-white"
        onclick={closeExplain}
        aria-label="Close explanation">✕</button
      >
    </div>

    <div class="flex flex-wrap gap-1.5 border-b border-gray-800 px-4 py-2 text-xs">
      {#if p.imageSource}
        <button
          class="rounded px-2 py-1 {p.withImage
            ? 'bg-primary-700 text-white'
            : 'bg-gray-700 hover:bg-gray-600'}"
          disabled={p.loading}
          onclick={() => reExplain({ withImage: !p.withImage, fresh: false })}
          title="Send the panel around the bubble to the AI as extra context"
          >{p.withImage ? 'With panel image ✓' : 'Add panel image'}</button
        >
      {/if}
      <button
        class="rounded px-2 py-1 disabled:opacity-50 {p.quality === 'thorough'
          ? 'bg-primary-700 text-white'
          : 'bg-gray-700 hover:bg-gray-600'}"
        disabled={p.loading}
        onclick={() =>
          reExplain({ quality: p.quality === 'thorough' ? 'fast' : 'thorough', fresh: false })}
        title="Use the slower, more thorough model"
        >{p.quality === 'thorough' ? 'In depth ✓' : 'In depth'}</button
      >
      <button
        class="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600 disabled:opacity-50"
        disabled={p.loading}
        onclick={() => reExplain({ fresh: true })}>Re-explain</button
      >
      <button
        class="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600 disabled:opacity-50"
        disabled={!ex}
        onclick={copy}>Copy</button
      >
      {#if p.result && !p.loading}
        <span class="self-center text-gray-500"
          >{providerNames[p.result.provider] ?? p.result.provider} · {p.result.model}{p.result
            .cached
            ? ' · saved'
            : ''}</span
        >
      {/if}
    </div>

    {#if cards.length && ex}
      <div
        class="flex flex-wrap items-center gap-1.5 border-b border-gray-800 px-4 py-2 text-xs text-gray-300"
      >
        <span>Your cards from this bubble:</span>
        {#each cards as c (c.noteId)}
          <button
            class="rounded px-2 py-1 disabled:opacity-60 {c.status === 'has'
              ? 'bg-green-800 text-white'
              : 'bg-gray-700 hover:bg-gray-600'}"
            disabled={c.status === 'adding'}
            onclick={() => addToCard(c)}
            title="Put translation and grammar into the card's Notes field"
            >{c.status === 'has'
              ? `✓ ${c.word} (update)`
              : c.status === 'adding'
                ? `Adding to ${c.word}…`
                : `Add to card: ${c.word}`}</button
          >
        {/each}
      </div>
    {/if}

    <div bind:this={scroller} class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
      {#if p.loading}
        <div class="space-y-2" aria-busy="true">
          <div class="text-gray-400">
            Asking the tutor… {elapsed > 0 ? `${elapsed} s` : ''}
          </div>
          <div class="h-4 w-4/5 animate-pulse rounded bg-gray-700"></div>
          <div class="h-4 w-3/5 animate-pulse rounded bg-gray-700"></div>
          <div class="h-16 w-full animate-pulse rounded bg-gray-800"></div>
        </div>
      {:else if p.error}
        <div class="rounded bg-red-900/50 px-3 py-2 text-red-100">{p.error}</div>
        <button
          class="rounded bg-gray-700 px-3 py-1.5 hover:bg-gray-600"
          onclick={() => reExplain({ fresh: false })}>Try again</button
        >
      {:else if ex}
        <section>
          <div class="text-base leading-snug">{ex.translation}</div>
          {#if ex.literal && ex.literal !== ex.translation}
            <div class="mt-1 text-gray-400">Literal: {ex.literal}</div>
          {/if}
          {#if ex.register}
            <div class="mt-1 text-xs text-gray-400">{ex.register}</div>
          {/if}
        </section>

        {#if ex.ocrSuspect}
          <div class="rounded bg-amber-900/50 px-3 py-2 text-xs text-amber-100">
            Possible OCR error: {ex.ocrSuspect}
          </div>
        {/if}

        {#if ex.grammar.length}
          <section class="space-y-2">
            <h3 class="text-xs tracking-wide text-gray-400 uppercase">Grammar</h3>
            {#each ex.grammar as g, i (i)}
              <div class="rounded border border-gray-700 bg-gray-800/60 p-2.5">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <span class="font-semibold text-primary-300">{g.pattern}</span>
                  {#if g.inText && g.inText !== g.pattern}
                    <span class="text-gray-400">in 「{g.inText}」</span>
                  {/if}
                </div>
                <div class="mt-1 leading-snug">{g.explanation}</div>
                {#if g.german}
                  <div class="mt-1 text-xs text-gray-300">
                    <span class="mr-1 rounded bg-gray-700 px-1 font-semibold">DE</span>{g.german}
                  </div>
                {/if}
                {#if g.russian}
                  <div class="mt-1 text-xs text-gray-300">
                    <span class="mr-1 rounded bg-gray-700 px-1 font-semibold">RU</span>{g.russian}
                  </div>
                {/if}
              </div>
            {/each}
          </section>
        {/if}

        {#if ex.breakdown.length}
          <section>
            <h3 class="mb-1 text-xs tracking-wide text-gray-400 uppercase">Word by word</h3>
            <ul class="divide-y divide-gray-800">
              {#each ex.breakdown as w, i (i)}
                <li class="py-1.5">
                  <div class="flex flex-wrap items-baseline gap-x-2">
                    <span class="text-base">{w.text}</span>
                    {#if w.reading && w.reading !== w.text}
                      <span class="text-gray-400">{w.reading}</span>
                    {/if}
                    {#if w.dictionaryForm && w.dictionaryForm !== w.text}
                      <span class="text-xs text-gray-500">← {w.dictionaryForm}</span>
                    {/if}
                    <span class="text-gray-200">{w.meaning}</span>
                  </div>
                  {#if w.role}<div class="text-xs text-gray-500">{w.role}</div>{/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if ex.notes.length}
          <section>
            <h3 class="mb-1 text-xs tracking-wide text-gray-400 uppercase">Notes</h3>
            <ul class="list-disc space-y-1 pl-5 text-gray-300">
              {#each ex.notes as n, i (i)}<li>{n}</li>{/each}
            </ul>
          </section>
        {/if}

        {#if p.result && (p.result.messages.length || p.pendingQuestion)}
          <section class="space-y-2 border-t border-gray-800 pt-3">
            {#each p.result.messages as m, i (i)}
              {#if m.role === 'user'}
                <div class="ml-8 rounded-lg bg-primary-800/60 px-3 py-2">{m.content}</div>
              {:else}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes HTML -->
                <div class="ai-md leading-snug">{@html renderMarkdown(m.content)}</div>
              {/if}
            {/each}
            {#if p.pendingQuestion}
              <div class="ml-8 rounded-lg bg-primary-800/60 px-3 py-2">{p.pendingQuestion}</div>
              {#if p.streaming}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes HTML -->
                <div class="ai-md leading-snug">{@html renderMarkdown(p.streaming)}</div>
              {:else if p.asking}
                <div class="text-gray-400">Thinking… {elapsed > 0 ? `${elapsed} s` : ''}</div>
              {/if}
            {/if}
          </section>
        {/if}
        {#if p.askError}
          <div class="rounded bg-red-900/50 px-3 py-2 text-red-100">{p.askError}</div>
        {/if}
      {/if}
    </div>

    <form
      class="flex gap-2 border-t border-gray-700 px-3 pt-2"
      style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))"
      onsubmit={submit}
    >
      <input
        class="min-w-0 flex-1 rounded border-gray-600 bg-gray-800 text-sm text-gray-100 placeholder-gray-500"
        placeholder={ex ? 'Ask a follow-up question…' : 'Waiting for the explanation…'}
        bind:value={question}
        disabled={!ex || p.asking}
        maxlength="500"
        enterkeyhint="send"
      />
      <button
        type="submit"
        class="rounded bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        disabled={!ex || p.asking || !question.trim()}>Ask</button
      >
    </form>
  </div>
{/if}

<style>
  .ai-md :global(p) {
    margin: 0 0 0.5rem;
  }
  .ai-md :global(ul) {
    list-style: disc;
    padding-left: 1.25rem;
    margin: 0 0 0.5rem;
  }
  .ai-md :global(ol) {
    list-style: decimal;
    padding-left: 1.25rem;
    margin: 0 0 0.5rem;
  }
  .ai-md :global(blockquote) {
    border-left: 3px solid rgb(75 85 99);
    padding-left: 0.6rem;
    margin: 0 0 0.5rem;
    color: rgb(209 213 219);
  }
  .ai-md :global(hr) {
    border-color: rgb(55 65 81);
    margin: 0.5rem 0;
  }
  .ai-md :global(code) {
    background: rgb(55 65 81);
    border-radius: 0.25rem;
    padding: 0 0.25rem;
  }
</style>

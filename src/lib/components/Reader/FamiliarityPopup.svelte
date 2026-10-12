<script lang="ts">
  import { onMount } from 'svelte';
  import {
    popupWord,
    installTapHandler,
    invalidate,
    vocab as vocabMap
  } from '$lib/familiarity/engine';
  import { familiarityApi } from '$lib/familiarity/api';
  import { setMiningWord, readingToKana } from '$lib/familiarity/mining-context';
  import { collectTextSegments, sliceRange } from '$lib/familiarity/offsets';
  import { vocabKey, type OverrideState, type VocabEntry } from '$lib/familiarity/types';
  import { settings } from '$lib/settings';
  import { showSnackbar } from '$lib/util';

  /**
   * Jiten word popup (manga-immersion fork): opened by a tap on a highlighted word. Shows reading,
   * glosses, frequency and the familiarity state; lets the user override the state (known / ignore /
   * learning / reset) and mine the word into Anki through the reader's existing capture flow.
   * Rendered as a plain positioned panel so it can later move to a second screen (AYN Thor).
   */
  let word = $derived($popupWord);
  let busy = $state(false);
  /** set after a first "Add to Anki" tap on a word Jiten already tracks; the second tap adds anyway */
  let confirmKnown = $state(false);
  let lastWordKey = '';
  $effect(() => {
    const key = word ? `${word.token.w}:${word.token.r}:${word.token.s}` : '';
    if (key !== lastWordKey) {
      lastWordKey = key;
      confirmKnown = false;
    }
  });

  const KNOWN_STATES: Record<number, string> = { 1: 'Young', 2: 'Mature', 4: 'Due', 5: 'Mastered' };
  /** Why this word probably should not be mined again (empty when it is new to the user). */
  function knownReason(v: VocabEntry | undefined): string {
    if (!v) return '';
    if (v.mined) return 'You already mined this word from manga.';
    const states = v.jiten.filter((st) => st in KNOWN_STATES).map((st) => KNOWN_STATES[st]);
    return states.length ? `Already in your cards (Jiten: ${states.join(', ')}).` : '';
  }
  let panel: HTMLDivElement | undefined = $state();
  let pos = $state({ left: 0, top: 0 });

  const stateLabel: Record<string, string> = {
    new: 'new',
    young: 'young',
    due: 'due',
    learning: 'learning (mine)'
  };

  function jitenStateNames(states: number[]): string {
    const names = [
      'New',
      'Young',
      'Mature',
      'Blacklisted',
      'Due',
      'Mastered',
      'Redundant',
      'Suspended'
    ];
    return states.map((s) => names[s] ?? String(s)).join(', ');
  }

  $effect(() => {
    if (!word || !panel) return;
    const r = panel.getBoundingClientRect();
    const pad = 8;
    let left = word.x + 12;
    let top = word.y + 12;
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, word.x - r.width - 12);
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, word.y - r.height - 12);
    pos = { left, top };
  });

  onMount(() => installTapHandler());

  function close() {
    popupWord.set(null);
  }

  async function override(state: OverrideState | null) {
    if (!word) return;
    busy = true;
    try {
      if (state) await familiarityApi.setOverride(word.token.w, word.token.r, state);
      else await familiarityApi.clearOverride(word.token.w, word.token.r);
      const entry = vocabMap.get(vocabKey(word.token.w, word.token.r));
      if (entry) entry.override = state;
      invalidate();
      showSnackbar(state ? `Marked as ${state}` : 'Override removed');
      close();
    } catch (e) {
      showSnackbar(`Could not save: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }

  function addToAnki() {
    if (!word) return;
    if (!confirmKnown && knownReason(word.vocab)) {
      confirmKnown = true;
      return;
    }
    if (!$settings.ankiConnectSettings.enabled) {
      showSnackbar('Enable AnkiConnect in the settings first');
      return;
    }
    if (word.vocab) setMiningWord(word.token, word.vocab, word.text);
    // Select the word from its current text nodes (ranges stored at highlight time may be stale after a
    // re-render), then hand the box to TextBoxes' capture flow via a custom event.
    const slices = sliceRange(collectTextSegments(word.box), word.token.s, word.token.e);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    if (slices.length && sel) {
      const r = document.createRange();
      r.setStart(slices[0].node, slices[0].start);
      r.setEnd(slices[slices.length - 1].node, slices[slices.length - 1].end);
      sel.addRange(r);
    }
    const box = word.box;
    const text = word.text;
    const token = word.token;
    const vocab = word.vocab;
    close();
    box.dispatchEvent(new CustomEvent('jiten:mine', { detail: { text, token, vocab } }));
  }
</script>

{#if word}
  {@const v = word.vocab}
  <div
    bind:this={panel}
    data-jiten-popup
    class="fixed z-[60] w-72 max-w-[calc(100vw-16px)] rounded-lg border border-gray-600 bg-gray-900/95 p-3 text-sm text-gray-100 shadow-xl backdrop-blur"
    style:left={`${pos.left}px`}
    style:top={`${pos.top}px`}
    role="dialog"
    aria-label="Word information"
  >
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="text-lg leading-tight font-semibold">
          {v?.spelling || word.text}
          {#if v && readingToKana(v.reading) !== (v.spelling || word.text)}
            <span class="ml-1 text-sm font-normal text-gray-300">{readingToKana(v.reading)}</span>
          {/if}
        </div>
        {#if word.text !== (v?.spelling ?? '')}
          <div class="text-xs text-gray-400">
            in text: {word.text}{v?.conj?.length ? ` · ${v.conj.join(' › ')}` : ''}
          </div>
        {/if}
      </div>
      <button
        class="rounded px-2 py-1 text-gray-400 hover:bg-gray-700 hover:text-white"
        onclick={close}
        aria-label="Close">✕</button
      >
    </div>

    {#if v}
      <ol class="mt-2 max-h-28 list-decimal space-y-0.5 overflow-y-auto pl-5 text-gray-200">
        {#each v.meanings.slice(0, 4) as sense, i (i)}
          <li>{sense.slice(0, 4).join('; ')}</li>
        {/each}
      </ol>
      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
        {#if v.freq > 0}<span>freq #{v.freq}</span>{/if}
        {#if v.pitch.length}<span>pitch {v.pitch.join('/')}</span>{/if}
        {#if v.pos.length}<span>{v.pos.slice(0, 2).join(', ')}</span>{/if}
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1 text-xs">
        <span class="rounded bg-gray-700 px-1.5 py-0.5"
          >Jiten: {jitenStateNames(v.jiten) || 'unknown'}</span
        >
        {#if v.override}<span class="rounded bg-amber-700 px-1.5 py-0.5"
            >override: {v.override}</span
          >{/if}
        {#if word.token.state}<span class="rounded bg-purple-800 px-1.5 py-0.5"
            >shown as {stateLabel[word.token.state]}</span
          >{/if}
        {#if v.mined}<span class="rounded bg-green-800 px-1.5 py-0.5">in Anki</span>{/if}
      </div>
    {:else}
      <div class="mt-2 text-xs text-gray-400">No dictionary data for this word.</div>
    {/if}

    <div class="mt-3 grid grid-cols-2 gap-1.5">
      {#if confirmKnown}
        <div class="col-span-2 rounded bg-amber-900/60 px-2 py-1.5 text-xs text-amber-100">
          {knownReason(v)} Add it anyway?
        </div>
        <button
          class="rounded bg-amber-600 px-2 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          disabled={busy}
          onclick={addToAnki}>Add anyway</button
        >
        <button
          class="rounded bg-gray-700 px-2 py-2 hover:bg-gray-600"
          onclick={() => (confirmKnown = false)}>Cancel</button
        >
      {:else}
        <button
          class="rounded bg-primary-600 px-2 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          disabled={busy}
          onclick={addToAnki}>Add to Anki{knownReason(v) ? ' ⚠' : ''}</button
        >
      {/if}
      <button
        class="rounded bg-gray-700 px-2 py-2 hover:bg-gray-600 disabled:opacity-50"
        disabled={busy}
        onclick={() => override('known')}>Mark known</button
      >
      <button
        class="rounded bg-gray-700 px-2 py-2 hover:bg-gray-600 disabled:opacity-50"
        disabled={busy}
        onclick={() => override('learning')}>Learning</button
      >
      <button
        class="rounded bg-gray-700 px-2 py-2 hover:bg-gray-600 disabled:opacity-50"
        disabled={busy}
        onclick={() => override('ignore')}>Ignore</button
      >
      {#if v?.override}
        <button
          class="col-span-2 rounded bg-gray-800 px-2 py-2 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          disabled={busy}
          onclick={() => override(null)}>Reset to Jiten state</button
        >
      {/if}
    </div>
  </div>
{/if}

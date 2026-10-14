<script lang="ts">
  import { seriesStudy } from '$lib/study/api';
  import { nav } from '$lib/util/hash-router';

  // manga-immersion fork: how much of a volume's text you already know (Jiten states + your marks)
  interface Props {
    series: string;
    volume: string;
    /** open the study page when tapped (used where the card itself is a button) */
    link?: boolean;
  }
  let { series, volume, link = false }: Props = $props();

  function open(e: Event) {
    if (!link) return;
    e.stopPropagation();
    e.preventDefault();
    nav.toStudy(series, volume);
  }

  let s = $derived($seriesStudy[series]?.[volume]);
  let c = $derived(s?.coverage ?? null);
  const colors = {
    easy: 'bg-green-700 text-white',
    ok: 'bg-yellow-600 text-white',
    hard: 'bg-red-700 text-white'
  };
</script>

{#if c}
  <span
    class="inline-flex w-fit items-center rounded px-1.5 py-0.5 text-xs font-medium {colors[
      c.label
    ]}"
    title="{Math.round(
      c.known * 100
    )}% of the words in this volume are known or in review ({Math.round(
      c.learning * 100
    )}% still learning) · {c.uniqueNew} new words"
  >
    {Math.round(c.known * 100)}% known · {c.uniqueNew} new
  </span>
{:else if s && (s.status === 'queued' || s.status === 'running')}
  <span class="inline-flex w-fit rounded bg-gray-600 px-1.5 py-0.5 text-xs text-white"
    >analysing…</span
  >
{/if}

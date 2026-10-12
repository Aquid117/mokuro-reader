<script lang="ts">
  import '$lib/streaming/resume';
  import { streamStatus } from '$lib/streaming/progressive';
  import { currentVolume } from '$lib/catalog';

  /** Small pill while the open volume's pages are still loading in the background (manga-immersion fork). */
  let status = $derived($currentVolume ? $streamStatus[$currentVolume.volume_uuid] : undefined);
</script>

{#if status && status.state !== 'complete'}
  <div
    class="pointer-events-none fixed bottom-3 left-3 z-50 rounded-full bg-gray-900/80 px-3 py-1 text-xs text-gray-200 shadow"
    role="status"
  >
    {#if status.state === 'paused'}
      Pages paused ({status.done}/{status.total}) – reopen to resume
    {:else}
      Loading pages {status.done}/{status.total}
    {/if}
  </div>
{:else if status && status.state === 'complete'}
  <div
    class="pointer-events-none fixed bottom-3 left-3 z-50 rounded-full bg-green-800/80 px-3 py-1 text-xs text-white shadow"
    role="status"
  >
    Volume available offline
  </div>
{/if}

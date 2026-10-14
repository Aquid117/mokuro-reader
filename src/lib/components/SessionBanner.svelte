<script lang="ts">
  import { sessionExpired, signInAgain } from '$lib/immersion/session';
  // manga-immersion fork: shown when the Authelia login of manga.aquid.eu expired (mostly in the PWA)
</script>

{#if $sessionExpired}
  <div
    class="fixed inset-x-0 top-0 z-[10001] flex items-center justify-center gap-3 bg-amber-700 px-4 py-2 text-sm text-white shadow-lg"
    style="padding-top: max(0.5rem, env(safe-area-inset-top))"
    role="alert"
  >
    <span>Your manga.aquid.eu login expired, so dictionary, Anki and AI help are paused.</span>
    <button
      class="rounded bg-white px-3 py-1 font-semibold text-amber-800 hover:bg-amber-100"
      onclick={signInAgain}>Sign in</button
    >
  </div>
{/if}

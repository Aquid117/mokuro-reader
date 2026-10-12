<script lang="ts">
  import CropperJS from 'cropperjs';
  import 'cropperjs/dist/cropper.css';
  import { onDestroy } from 'svelte';
  import { minePreview } from '$lib/familiarity/mine-preview';
  import { cropRect, type CropMode, type Rect } from '$lib/familiarity/panel-crop';

  // manga-immersion fork: preview + adjust the card image before a one-tap card is added

  let cropper: CropperJS | null = null;
  let mode = $state<CropMode>('panel');
  let working = $state(false);

  const modes: { key: CropMode; label: string }[] = [
    { key: 'bubble', label: 'Bubble' },
    { key: 'panel', label: 'Panel' },
    { key: 'page', label: 'Page' }
  ];

  function applyRect(r: Rect) {
    cropper?.setData({ x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] });
  }

  function initCropper(img: HTMLImageElement) {
    const req = $minePreview;
    if (!req) return;
    mode = req.mode;
    const setup = () => {
      cropper?.destroy();
      cropper = new CropperJS(img, {
        viewMode: 1, // crop box stays inside the image
        dragMode: 'none',
        autoCropArea: 1,
        restore: false,
        guides: false,
        center: false,
        highlight: false,
        background: false,
        zoomable: false,
        rotatable: false,
        scalable: false,
        toggleDragModeOnDblclick: false,
        aspectRatio: NaN,
        ready() {
          applyRect(req.rect);
        }
      });
    };
    if (img.complete && img.naturalWidth) setup();
    else img.addEventListener('load', setup, { once: true });
    return {
      destroy() {
        cropper?.destroy();
        cropper = null;
      }
    };
  }

  async function setMode(m: CropMode) {
    const req = $minePreview;
    if (!req || working) return;
    working = true;
    try {
      mode = m;
      applyRect(await cropRect(req.bitmap, req.bubble, m));
    } finally {
      working = false;
    }
  }

  function confirm() {
    const req = $minePreview;
    if (!req || !cropper) return;
    const d = cropper.getData(true);
    req.resolve([d.x, d.y, d.x + d.width, d.y + d.height]);
  }

  function cancel() {
    $minePreview?.resolve(null);
  }

  function onKey(e: KeyboardEvent) {
    if (!$minePreview) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter') {
      e.stopPropagation();
      confirm();
    }
  }

  onDestroy(() => $minePreview?.resolve(null));
</script>

<svelte:window onkeydown={onKey} />

{#if $minePreview}
  {@const req = $minePreview}
  <div
    class="fixed inset-0 z-[10000] flex flex-col bg-black/90 text-gray-100"
    role="dialog"
    aria-modal="true"
    aria-label="Card image preview"
  >
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3 pb-2">
      <span class="text-xl font-semibold">{req.word}</span>
      {#if req.reading && req.reading !== req.word}
        <span class="text-gray-400">{req.reading}</span>
      {/if}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped by buildMangaFields -->
      <span class="min-w-0 flex-1 truncate text-sm text-gray-300">{@html req.sentenceHtml}</span>
    </div>

    <div class="relative min-h-0 flex-1 px-2">
      {#key req.imageUrl}
        <img
          use:initCropper
          src={req.imageUrl}
          alt="Page"
          class="block max-h-full max-w-full"
          style="opacity: 0"
        />
      {/key}
    </div>

    <div
      class="flex flex-wrap items-center justify-between gap-2 px-4 pt-2"
      style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))"
    >
      <div class="flex overflow-hidden rounded-lg border border-gray-600" role="group">
        {#each modes as m (m.key)}
          <button
            class="px-4 py-2 text-sm {mode === m.key
              ? 'bg-primary-600 text-white'
              : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}"
            disabled={working}
            onclick={() => setMode(m.key)}>{m.label}</button
          >
        {/each}
      </div>
      <span class="hidden text-xs text-gray-400 sm:inline">Drag the corners to adjust</span>
      <div class="flex gap-2">
        <button class="rounded-lg bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600" onclick={cancel}
          >Cancel</button
        >
        <button
          class="rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-700"
          onclick={confirm}>Add to {req.deck}</button
        >
      </div>
    </div>
  </div>
{/if}

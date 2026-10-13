import { writable, get } from 'svelte/store';
import { settings } from '$lib/settings';
import { cropRect, encodeCrop, bubbleInBitmap } from '$lib/familiarity/panel-crop';
import {
  aiApi,
  askFollowup,
  type AiChoice,
  type AiQuality,
  type AiStatus,
  type ExplainResult
} from './api';
import type { ExplainContext, ImageSource } from './context';

/** State of the AI explanation panel (manga-immersion fork). */
export interface AiPanelState {
  open: boolean;
  ctx: ExplainContext | null;
  imageSource: ImageSource | null;
  withImage: boolean;
  quality: AiQuality;
  loading: boolean;
  /** when the current request started (for the elapsed-seconds display) */
  startedAt: number;
  error: string | null;
  result: ExplainResult | null;
  asking: boolean;
  pendingQuestion: string | null;
  streaming: string;
  askError: string | null;
}

const closed: AiPanelState = {
  open: false,
  ctx: null,
  imageSource: null,
  withImage: false,
  quality: 'fast',
  loading: false,
  startedAt: 0,
  error: null,
  result: null,
  asking: false,
  pendingQuestion: null,
  streaming: '',
  askError: null
};

export const aiPanel = writable<AiPanelState>(closed);
export const aiStatus = writable<AiStatus | null>(null);

export async function refreshAiStatus(): Promise<AiStatus | null> {
  try {
    const s = await aiApi.status();
    aiStatus.set(s);
    return s;
  } catch {
    return get(aiStatus);
  }
}

/** AI help is offered unless switched off in settings or the server says it has no key. */
export function aiAvailable(s: AiStatus | null, enabled: boolean | undefined): boolean {
  return enabled !== false && s?.configured !== false;
}

async function panelImage(src: ImageSource): Promise<string> {
  const bitmap = await createImageBitmap(src.blob);
  try {
    const bubble = bubbleInBitmap(src.bubble, src.pageSize, bitmap);
    const rect = await cropRect(bitmap, bubble, 'panel');
    return await encodeCrop(bitmap, rect, 768, 0.8);
  } finally {
    bitmap.close();
  }
}

let runId = 0;

function choice(quality: AiQuality): AiChoice {
  const provider = get(settings).ai?.provider;
  return { provider: provider && provider !== 'auto' ? provider : undefined, quality };
}

async function run(fresh: boolean): Promise<void> {
  const s = get(aiPanel);
  if (!s.ctx) return;
  const id = ++runId;
  aiPanel.update((p) => ({
    ...p,
    loading: true,
    startedAt: Date.now(),
    error: null,
    askError: null
  }));
  try {
    let image: string | undefined;
    if (s.withImage && s.imageSource) {
      try {
        image = await panelImage(s.imageSource);
      } catch {
        image = undefined; // explain without the image rather than failing
      }
    }
    const result = await aiApi.explain({ ...s.ctx, ...choice(s.quality), image, fresh });
    if (id !== runId) return;
    aiPanel.update((p) => ({ ...p, loading: false, result }));
    void refreshAiStatus();
  } catch (e) {
    if (id !== runId) return;
    aiPanel.update((p) => ({ ...p, loading: false, error: (e as Error).message }));
  }
}

export function openExplain(ctx: ExplainContext, imageSource: ImageSource | null = null): void {
  if (!ctx.text) return;
  const includeImage = get(settings).ai?.includeImage ?? false;
  aiPanel.set({
    ...closed,
    open: true,
    ctx,
    imageSource,
    withImage: includeImage && !!imageSource
  });
  void run(false);
}

/**
 * Explain again: `fresh` bypasses the cache, `withImage` toggles the panel image, `quality` switches to
 * the in-depth model (or back).
 */
export function reExplain(
  opts: { withImage?: boolean; fresh?: boolean; quality?: AiQuality } = {}
): void {
  aiPanel.update((p) => {
    const changed =
      (opts.withImage !== undefined && opts.withImage !== p.withImage) ||
      (opts.quality !== undefined && opts.quality !== p.quality);
    return {
      ...p,
      withImage: opts.withImage ?? p.withImage,
      quality: opts.quality ?? p.quality,
      result: changed ? null : p.result
    };
  });
  void run(opts.fresh ?? true);
}

export async function ask(question: string): Promise<void> {
  const s = get(aiPanel);
  const q = question.trim();
  if (!s.result || s.asking || !q) return;
  aiPanel.update((p) => ({
    ...p,
    asking: true,
    startedAt: Date.now(),
    pendingQuestion: q,
    streaming: '',
    askError: null
  }));
  try {
    // follow-ups stay with the provider that wrote the explanation
    await askFollowup(
      s.result.id,
      q,
      (d) => aiPanel.update((p) => ({ ...p, streaming: p.streaming + d })),
      { provider: s.result.provider, quality: s.quality }
    );
    aiPanel.update((p) => {
      if (!p.result) return p;
      const now = Date.now();
      const messages = [
        ...p.result.messages,
        { role: 'user' as const, content: q, ts: now },
        { role: 'assistant' as const, content: p.streaming, ts: now + 1 }
      ];
      return {
        ...p,
        asking: false,
        pendingQuestion: null,
        streaming: '',
        result: { ...p.result, messages }
      };
    });
    void refreshAiStatus();
  } catch (e) {
    aiPanel.update((p) => ({ ...p, asking: false, askError: (e as Error).message }));
  }
}

export function closeExplain(): void {
  runId++;
  aiPanel.set(closed);
}

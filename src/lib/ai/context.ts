import type { Page } from '$lib/types';
import type { Rect } from '$lib/familiarity/panel-crop';

/** What the backend needs to explain one speech bubble (manga-immersion fork, AI help). */
export interface ExplainContext {
  text: string;
  before: string[];
  after: string[];
  series?: string;
  volume?: string;
  page?: number;
  focusWord?: string;
}

/** Page image + bubble box, used to attach the panel image when the user asks for it. */
export interface ImageSource {
  blob: Blob;
  bubble: Rect; // OCR page pixels
  pageSize: { width: number; height: number };
}

const CONTEXT_BUBBLES = 3;

/** OCR lines of a block joined without separators (Japanese has no spaces between lines). */
export function blockText(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .join('')
    .slice(0, 600);
}

/** Focus bubble plus up to three bubbles before/after it on the page (mokuro order ≈ reading order). */
export function contextFromPage(
  page: Page,
  blockIndex: number,
  meta: { series?: string; volume?: string; page?: number; focusWord?: string } = {}
): ExplainContext {
  const texts = page.blocks.map((b) => blockText(b.lines));
  const nonEmpty = (t: string) => t.length > 0;
  return {
    text: texts[blockIndex] ?? '',
    before: texts.slice(Math.max(0, blockIndex - CONTEXT_BUBBLES), blockIndex).filter(nonEmpty),
    after: texts.slice(blockIndex + 1, blockIndex + 1 + CONTEXT_BUBBLES).filter(nonEmpty),
    series: meta.series || undefined,
    volume: meta.volume || undefined,
    page: meta.page,
    focusWord: meta.focusWord || undefined
  };
}

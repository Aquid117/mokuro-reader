import { writable } from 'svelte/store';
import type { CropMode, Rect } from './panel-crop';

/**
 * Card image preview (manga-immersion fork): before a one-tap card is added, the detected crop is shown
 * on the page and can be adjusted or switched to bubble / panel / full page. Resolves with the chosen
 * rectangle (bitmap pixels) or null when cancelled.
 */
export interface MinePreviewRequest {
  imageUrl: string;
  bitmap: ImageBitmap;
  bubble: Rect; // bitmap pixels
  rect: Rect; // initial crop, bitmap pixels
  mode: CropMode;
  word: string;
  reading: string;
  sentenceHtml: string;
  deck: string;
  resolve: (rect: Rect | null) => void;
}

export const minePreview = writable<MinePreviewRequest | null>(null);

export function requestMinePreview(req: Omit<MinePreviewRequest, 'resolve'>): Promise<Rect | null> {
  return new Promise((resolve) => {
    minePreview.set({
      ...req,
      resolve: (rect) => {
        minePreview.set(null);
        resolve(rect);
      }
    });
  });
}

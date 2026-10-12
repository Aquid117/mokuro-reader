/**
 * Panel-sized crop around a speech bubble.
 *
 * Mokuro gives text-box boxes, not panel coordinates, so the panel is detected from the page itself:
 * starting at the bubble, each edge moves outward until it reaches a *gutter* — a band of near-white
 * lines spanning the current crop that is preceded by a dark panel border. Edges that never meet a
 * gutter stop at the page edge (bleed panels). If the result is implausible (most of the page), a
 * generous fixed margin around the bubble is used instead.
 */
export interface Gray {
  data: Uint8Array; // one byte per pixel, row-major
  width: number;
  height: number;
}
export type Rect = [number, number, number, number]; // x0, y0, x1, y1 (x1/y1 exclusive)

const WHITE = 225;
const DARK = 110;

function columnStats(g: Gray, x: number, y0: number, y1: number) {
  let white = 0;
  let dark = 0;
  for (let y = y0; y < y1; y++) {
    const v = g.data[y * g.width + x];
    if (v >= WHITE) white++;
    else if (v <= DARK) dark++;
  }
  const n = Math.max(1, y1 - y0);
  return { white: white / n, dark: dark / n };
}

function rowStats(g: Gray, y: number, x0: number, x1: number) {
  let white = 0;
  let dark = 0;
  const off = y * g.width;
  for (let x = x0; x < x1; x++) {
    const v = g.data[off + x];
    if (v >= WHITE) white++;
    else if (v <= DARK) dark++;
  }
  const n = Math.max(1, x1 - x0);
  return { white: white / n, dark: dark / n };
}

/**
 * Walk from `start` in direction `step` (±1) up to `limit` (exclusive bound) and return the coordinate of
 * the panel border (the last line inside the panel), or `limit - step` if no gutter is found.
 */
function findEdge(
  stats: (pos: number) => { white: number; dark: number },
  start: number,
  step: 1 | -1,
  limit: number,
  minBand: number
): number {
  let band = 0;
  let sawBorder = false;
  for (let pos = start; pos !== limit; pos += step) {
    const s = stats(pos);
    if (s.white >= 0.97) {
      band++;
      if (band >= minBand && sawBorder) return pos - step * band;
    } else {
      const isBorder = s.dark >= 0.45;
      // A wide white band that ends in busy artwork (not a border line) is an unframed gutter. A white band
      // that ends in a border line was a white panel interior: keep going, the gutter lies beyond.
      if (!isBorder && band >= minBand * 4) return pos - step * (band + 1);
      sawBorder = isBorder || (sawBorder && band === 0 && s.dark >= 0.2);
      band = 0;
    }
  }
  if (band >= minBand * 2) return limit - step * (band + 1);
  return limit - step;
}

export function detectPanel(g: Gray, bubble: Rect): Rect {
  const W = g.width;
  const H = g.height;
  const clampRect = (r: Rect): Rect => [
    Math.max(0, Math.min(W - 1, Math.round(r[0]))),
    Math.max(0, Math.min(H - 1, Math.round(r[1]))),
    Math.max(1, Math.min(W, Math.round(r[2]))),
    Math.max(1, Math.min(H, Math.round(r[3])))
  ];
  const b = clampRect(bubble);
  const minBand = Math.max(2, Math.round(Math.min(W, H) * 0.004));
  let [x0, y0, x1, y1] = b;

  for (let pass = 0; pass < 2; pass++) {
    x0 = findEdge((x) => columnStats(g, x, y0, y1), b[0] - 1, -1, -1, minBand);
    x1 = findEdge((x) => columnStats(g, x, y0, y1), b[2], 1, W, minBand) + 1;
    y0 = findEdge((y) => rowStats(g, y, x0, x1), b[1] - 1, -1, -1, minBand);
    y1 = findEdge((y) => rowStats(g, y, x0, x1), b[3], 1, H, minBand) + 1;
    x0 = Math.min(x0, b[0]);
    y0 = Math.min(y0, b[1]);
    x1 = Math.max(x1, b[2]);
    y1 = Math.max(y1, b[3]);
  }

  const area = (x1 - x0) * (y1 - y0);
  const bubbleArea = (b[2] - b[0]) * (b[3] - b[1]);
  if (area > 0.6 * W * H || area < bubbleArea * 1.2) return generousCrop(W, H, b);
  // a little breathing room so the border line itself is visible
  const pad = Math.round(Math.min(W, H) * 0.006);
  return clampRect([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
}

/** Fallback: the bubble plus roughly its own size around it, at least ~45% of the page width/30% height. */
export function generousCrop(W: number, H: number, b: Rect): Rect {
  const bw = b[2] - b[0];
  const bh = b[3] - b[1];
  const wantW = Math.max(bw * 2.5, W * 0.45);
  const wantH = Math.max(bh * 2, H * 0.3);
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  let x0 = cx - wantW / 2;
  let y0 = cy - wantH / 2;
  x0 = Math.max(0, Math.min(W - wantW, x0));
  y0 = Math.max(0, Math.min(H - wantH, y0));
  return [
    Math.round(Math.max(0, x0)),
    Math.round(Math.max(0, y0)),
    Math.round(Math.min(W, x0 + wantW)),
    Math.round(Math.min(H, y0 + wantH))
  ];
}

/** Grayscale copy of an image, downscaled so the long side is ≤ maxSide (analysis only). */
export async function toGray(
  bitmap: ImageBitmap,
  maxSide = 900
): Promise<{ gray: Gray; scale: number }> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < data.length; i += 4, j++)
    data[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return { gray: { data, width: w, height: h }, scale };
}

export type CropMode = 'panel' | 'bubble' | 'page';

/**
 * Crop the page image for an Anki card and return base64 JPEG (no data: prefix).
 * `bubble` is in original image pixels; `pageSize` is the OCR page size (img_width/img_height), which can
 * differ from the bitmap size (upscaled releases), so coordinates are rescaled.
 */
export async function cropForCard(
  blob: Blob,
  bubble: Rect,
  pageSize: { width: number; height: number },
  mode: CropMode,
  maxSide = 1000,
  quality = 0.82
): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const sx = bitmap.width / pageSize.width;
  const sy = bitmap.height / pageSize.height;
  const bub: Rect = [bubble[0] * sx, bubble[1] * sy, bubble[2] * sx, bubble[3] * sy];
  let rect: Rect;
  if (mode === 'page') rect = [0, 0, bitmap.width, bitmap.height];
  else if (mode === 'bubble') {
    const mx = (bub[2] - bub[0]) * 0.15 + bitmap.width * 0.01;
    const my = (bub[3] - bub[1]) * 0.1 + bitmap.height * 0.01;
    rect = [
      Math.max(0, bub[0] - mx),
      Math.max(0, bub[1] - my),
      Math.min(bitmap.width, bub[2] + mx),
      Math.min(bitmap.height, bub[3] + my)
    ];
  } else {
    const { gray, scale } = await toGray(bitmap);
    const r = detectPanel(gray, [bub[0] * scale, bub[1] * scale, bub[2] * scale, bub[3] * scale]);
    rect = [r[0] / scale, r[1] / scale, r[2] / scale, r[3] / scale];
  }
  const cw = Math.max(1, Math.round(rect[2] - rect[0]));
  const ch = Math.max(1, Math.round(rect[3] - rect[1]));
  const out = Math.min(1, maxSide / Math.max(cw, ch));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(cw * out)),
    Math.max(1, Math.round(ch * out))
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect[0], rect[1], cw, ch, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  const buf = new Uint8Array(await jpeg.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

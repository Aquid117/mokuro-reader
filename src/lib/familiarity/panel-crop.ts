/**
 * Panel-sized crop around a speech bubble. Mokuro gives text-box boxes, not panel coordinates, so the
 * panel is detected from the page itself (see detectPanel). If the result is implausible (most of the
 * page, or no gutters at all), a margin around the bubble is used instead.
 */
export interface Gray {
  data: Uint8Array; // one byte per pixel, row-major
  width: number;
  height: number;
}
export type Rect = [number, number, number, number]; // x0, y0, x1, y1 (x1/y1 exclusive)

/**
 * Gutters are the background (white, or black on dark pages) connected to the page margin. Flood-fill
 * that background from the margins — only through pixels whose 3x3 neighbourhood is all background, so
 * 1–2 px gaps in panel borders and thin, blurred border lines still block — then take the connected
 * region of everything *not* reached that contains the bubble: that region is the bubble's panel.
 */
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
  const d = g.data;

  // margin colour decides what "background" means
  let marginSum = 0;
  let marginN = 0;
  for (let x = 0; x < W; x++) {
    marginSum += d[x] + d[(H - 1) * W + x];
    marginN += 2;
  }
  for (let y = 0; y < H; y++) {
    marginSum += d[y * W] + d[y * W + W - 1];
    marginN += 2;
  }
  const darkPage = marginSum / marginN < 90;
  const bg = new Uint8Array(W * H);
  for (let i = 0; i < d.length; i++) bg[i] = darkPage ? (d[i] <= 40 ? 1 : 0) : d[i] >= 225 ? 1 : 0;
  // erode: a pixel is passable only if it and its 8 neighbours are background
  const pass = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (
        bg[i] &&
        bg[i - 1] &&
        bg[i + 1] &&
        bg[i - W] &&
        bg[i + W] &&
        bg[i - W - 1] &&
        bg[i - W + 1] &&
        bg[i + W - 1] &&
        bg[i + W + 1]
      )
        pass[i] = 1;
    }
  }
  for (let x = 0; x < W; x++) {
    pass[x] = bg[x];
    pass[(H - 1) * W + x] = bg[(H - 1) * W + x];
  }
  for (let y = 0; y < H; y++) {
    pass[y * W] = bg[y * W];
    pass[y * W + W - 1] = bg[y * W + W - 1];
  }

  // 1) flood the outside (margins + gutters)
  const outside = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0;
  const seed = (i: number) => {
    if (pass[i] && !outside[i]) {
      outside[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x);
    seed((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    seed(y * W);
    seed(y * W + W - 1);
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % W;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (i >= W) seed(i - W);
    if (i < (H - 1) * W) seed(i + W);
  }
  let outsideCount = 0;
  for (let i = 0; i < outside.length; i++) outsideCount += outside[i];
  if (outsideCount < 0.02 * W * H) return generousCrop(W, H, b); // full-bleed page: no gutters to find

  // 2) the non-outside component that contains the bubble
  const cx = Math.round((b[0] + b[2]) / 2);
  const cy = Math.round((b[1] + b[3]) / 2);
  let start = -1;
  for (let r = 0; r < Math.max(b[2] - b[0], b[3] - b[1]) && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < b[0] || x >= b[2] || y < b[1] || y >= b[3]) continue;
        if (!outside[y * W + x]) {
          start = y * W + x;
          break;
        }
      }
  }
  if (start < 0) return generousCrop(W, H, b);
  const seen = new Uint8Array(W * H);
  let x0 = W,
    y0 = H,
    x1 = 0,
    y1 = 0,
    count = 0;
  sp = 0;
  stack[sp++] = start;
  seen[start] = 1;
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % W;
    const y = (i - x) / W;
    count++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    const nb = [
      x > 0 ? i - 1 : -1,
      x < W - 1 ? i + 1 : -1,
      y > 0 ? i - W : -1,
      y < H - 1 ? i + W : -1
    ];
    for (const j of nb) {
      if (j >= 0 && !seen[j] && !outside[j]) {
        seen[j] = 1;
        stack[sp++] = j;
      }
    }
  }
  x0 = Math.min(x0, b[0]);
  y0 = Math.min(y0, b[1]);
  x1 = Math.max(x1 + 1, b[2]);
  y1 = Math.max(y1 + 1, b[3]);
  const area = (x1 - x0) * (y1 - y0);
  const bubbleArea = (b[2] - b[0]) * (b[3] - b[1]);
  if (area > 0.6 * W * H || area < bubbleArea * 1.2 || count < 50) return generousCrop(W, H, b);
  const pad = Math.round(Math.min(W, H) * 0.008);
  return clampRect([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
}

/** Fallback: the bubble plus roughly its own size around it, at least ~45% of the page width/30% height. */
export function generousCrop(W: number, H: number, b: Rect): Rect {
  const bw = b[2] - b[0];
  const bh = b[3] - b[1];
  const wantW = Math.min(W, Math.max(bw * 1.6, W * 0.4));
  const wantH = Math.min(H, Math.max(bh * 2, H * 0.25));
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

/** Scales an OCR box (page size from the .mokuro file) to the bitmap's pixels (upscaled releases differ). */
export function bubbleInBitmap(
  bubble: Rect,
  pageSize: { width: number; height: number },
  bitmap: { width: number; height: number }
): Rect {
  const sx = bitmap.width / pageSize.width;
  const sy = bitmap.height / pageSize.height;
  return [bubble[0] * sx, bubble[1] * sy, bubble[2] * sx, bubble[3] * sy];
}

/** Crop rectangle (bitmap pixels) for a mode, around a bubble given in bitmap pixels. */
export async function cropRect(bitmap: ImageBitmap, bub: Rect, mode: CropMode): Promise<Rect> {
  if (mode === 'page') return [0, 0, bitmap.width, bitmap.height];
  if (mode === 'bubble') {
    const mx = (bub[2] - bub[0]) * 0.15 + bitmap.width * 0.01;
    const my = (bub[3] - bub[1]) * 0.1 + bitmap.height * 0.01;
    return [
      Math.max(0, bub[0] - mx),
      Math.max(0, bub[1] - my),
      Math.min(bitmap.width, bub[2] + mx),
      Math.min(bitmap.height, bub[3] + my)
    ];
  }
  const { gray, scale } = await toGray(bitmap);
  const r = detectPanel(gray, [bub[0] * scale, bub[1] * scale, bub[2] * scale, bub[3] * scale]);
  return [r[0] / scale, r[1] / scale, r[2] / scale, r[3] / scale];
}

/** JPEG of `rect` (bitmap pixels), long side ≤ maxSide, as base64 without the data: prefix. */
export async function encodeCrop(
  bitmap: ImageBitmap,
  rect: Rect,
  maxSide = 1000,
  quality = 0.82
): Promise<string> {
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
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  const buf = new Uint8Array(await jpeg.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Crop the page image for an Anki card and return base64 JPEG (no data: prefix).
 * `bubble` is in OCR page pixels (img_width/img_height).
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
  try {
    const rect = await cropRect(bitmap, bubbleInBitmap(bubble, pageSize, bitmap), mode);
    return await encodeCrop(bitmap, rect, maxSide, quality);
  } finally {
    bitmap.close();
  }
}

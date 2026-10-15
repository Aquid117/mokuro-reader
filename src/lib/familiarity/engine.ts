import { writable, get } from 'svelte/store';
import { familiarityApi, ApiError } from './api';
import {
  collectTextSegments,
  blockText,
  sliceRange,
  slicesToRanges,
  type TextSegment
} from './offsets';
import { vocabKey, type EffectiveState, type ParsedToken, type VocabEntry } from './types';
import type { FamiliaritySettings } from '$lib/settings/settings';
import { furiganaFor } from './furigana';

/**
 * Familiarity highlighting engine.
 *
 * - Collects the rendered OCR text of every text box on a page, asks the backend (one batched request
 *   per flush, so a two-page spread costs one Jiten call) and caches tokens per block text in memory.
 * - Paints words with the CSS Custom Highlight API: no extra DOM, so Yomitan/10ten and the reader's
 *   gesture/selection code see exactly the same text nodes as before.
 * - One Highlight per state is shared by all mounted pages; each page keeps its own ranges and the
 *   registry is rebuilt whenever a page updates or unmounts.
 */

export const HIGHLIGHT_NAMES = [
  'jiten-new',
  'jiten-young',
  'jiten-due',
  'jiten-learning',
  'jiten-mined'
] as const;
type HighlightName = (typeof HIGHLIGHT_NAMES)[number];

export const familiarityWarning = writable<string | null>(null);
export const familiarityBusy = writable(false);

export interface PopupWord {
  token: ParsedToken;
  vocab: VocabEntry | undefined;
  text: string;
  range: Range;
  box: HTMLElement;
  x: number;
  y: number;
}
/** The word under the last tap on a highlighted token (drives FamiliarityPopup). */
export const popupWord = writable<PopupWord | null>(null);

export function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

interface PageEntry {
  blocks: { el: HTMLElement; segments: TextSegment[]; text: string; tokens?: ParsedToken[] }[];
  ranges: Map<HighlightName, Range[]>;
  /** word identity for each range, for hit-testing (popup) */
  hits: { range: Range; token: ParsedToken }[];
}

const tokenCache = new Map<string, ParsedToken[]>(); // block text → tokens
export const vocab = new Map<string, VocabEntry>(); // "wordId:readingIndex" → entry
const pages = new Map<string, PageEntry>();
let currentSettings: FamiliaritySettings | null = null;
/** series of the pages being highlighted: its ignore list applies (manga-immersion fork) */
let currentSeries: string | undefined;

export function setFamiliaritySeries(series: string | undefined): void {
  if (series === currentSeries) return;
  currentSeries = series;
  tokenCache.clear(); // states differ per series (ignore lists)
}

export function getFamiliaritySeries(): string | undefined {
  return currentSeries;
}
let pending: { key: string; text: string; resolve: (t: ParsedToken[]) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
/** after a failed/degraded backend answer, do not hammer it: wait before asking again */
let cooldownUntil = 0;
const COOLDOWN_MS = 30_000;

function stateToName(state: EffectiveState): HighlightName | null {
  switch (state) {
    case 'new':
      return 'jiten-new';
    case 'young':
      return 'jiten-young';
    case 'due':
      return 'jiten-due';
    case 'learning':
      return 'jiten-learning';
    default:
      return null;
  }
}

/** Push the configured colours into CSS variables consumed by the ::highlight() rules in app.css. */
export function applySettings(s: FamiliaritySettings): void {
  currentSettings = s;
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const k of ['new', 'young', 'due', 'learning', 'mined'] as const) {
    root.setProperty(`--jiten-${k}`, s.colors[k]);
    root.setProperty(
      `--jiten-${k}-bg`,
      s.background ? hexToRgba(s.colors[k], s.intensity) : 'transparent'
    );
  }
  rebuildRegistry();
  for (const entry of pages.values()) scheduleOverlays(entry); // tint / furigana settings may have changed
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'transparent';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

function requestTokens(key: string, text: string): Promise<ParsedToken[]> {
  const cached = tokenCache.get(text);
  if (cached) return Promise.resolve(cached);
  if (Date.now() < cooldownUntil) return Promise.resolve([]);
  return new Promise((resolve) => {
    pending.push({ key, text, resolve });
    if (!flushTimer) flushTimer = setTimeout(flush, 40);
  });
}

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = pending;
  pending = [];
  if (batch.length === 0) return;
  // de-duplicate identical texts within the batch
  const byText = new Map<string, typeof batch>();
  for (const b of batch) byText.set(b.text, [...(byText.get(b.text) ?? []), b]);
  const blocks = [...byText.keys()].map((text, i) => ({ key: `b${i}`, text }));
  familiarityBusy.set(true);
  try {
    const res = await familiarityApi.parse(blocks, currentSeries);
    for (const [k, v] of Object.entries(res.vocab)) vocab.set(k, v);
    blocks.forEach((blk, i) => {
      const tokens = res.blocks[i]?.tokens ?? [];
      // only cache answers that actually came back (a failed parse returns no tokens + warning)
      if (!res.warning || res.blocks[i]?.cached) tokenCache.set(blk.text, tokens);
      for (const waiter of byText.get(blk.text) ?? []) waiter.resolve(tokens);
    });
    familiarityWarning.set(res.warning ?? null);
    if (res.warning && res.source === 'none') cooldownUntil = Date.now() + COOLDOWN_MS;
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Familiarity backend unreachable';
    familiarityWarning.set(msg);
    cooldownUntil = Date.now() + COOLDOWN_MS;
    for (const b of batch) b.resolve([]);
  } finally {
    familiarityBusy.set(false);
  }
}

/** Called by TextBoxes after render: (re)highlight all text boxes of one page. */
export async function highlightPage(pageKey: string, boxes: HTMLElement[]): Promise<void> {
  if (!highlightsSupported() || !currentSettings?.enabled) return;
  const gen = ++generation;
  const entry: PageEntry = { blocks: [], ranges: new Map(), hits: [] };
  for (const el of boxes) {
    const segments = collectTextSegments(el);
    const text = blockText(segments);
    if (!text.trim()) continue;
    entry.blocks.push({ el, segments, text });
  }
  pages.set(pageKey, entry);
  const results = await Promise.all(
    entry.blocks.map((b, i) => requestTokens(`${pageKey}:${i}`, b.text))
  );
  if (gen !== generation && !pages.has(pageKey)) return; // page went away meanwhile
  const s = currentSettings;
  for (let i = 0; i < entry.blocks.length; i++) {
    const { segments } = entry.blocks[i];
    for (const t of results[i]) {
      const v = vocab.get(vocabKey(t.w, t.r));
      if (s.minFrequencyRank > 0 && v && v.freq > 0 && v.freq < s.minFrequencyRank) continue;
      let name = stateToName(t.state);
      if (name && s.onlyUnknown && name !== 'jiten-new') name = null;
      const slices = sliceRange(segments, t.s, t.e);
      if (slices.length === 0) continue;
      const ranges = slicesToRanges(slices);
      if (name) entry.ranges.set(name, [...(entry.ranges.get(name) ?? []), ...ranges]);
      if (s.showMined && v?.mined)
        entry.ranges.set('jiten-mined', [...(entry.ranges.get('jiten-mined') ?? []), ...ranges]);
      for (const r of ranges) entry.hits.push({ range: r, token: t });
    }
    entry.blocks[i].tokens = results[i];
  }
  rebuildRegistry();
  scheduleOverlays(entry);
}

/* ---- word overlay (manga-immersion fork) ------------------------------------------------------------
 * Each text box has a sibling `.word-overlay` at the same position (TextBoxes.svelte). It receives
 * - tints: coloured boxes behind words on the page image, so "tint background" works with the OCR text
 *   hidden (the visible OCR box covers them; then the ::highlight background takes over), and
 * - furigana: small kana beside kanji groups, shown by CSS only while the OCR text is visible.
 * Kana are drawn via CSS content (no text nodes), so text extraction, selection, 10ten and mining
 * see the OCR text exactly as before. Positions come from the laid-out (hidden) OCR text. */

function overlayOf(el: HTMLElement): HTMLElement | null {
  const n = el.nextElementSibling;
  return n instanceof HTMLElement && n.classList.contains('word-overlay') ? n : null;
}

function furiganaWanted(state: EffectiveState, s: FamiliaritySettings): boolean {
  const f = s.furigana;
  if (!f?.enabled) return false;
  if (f.scope === 'all') return true;
  if (f.scope === 'new') return state === 'new';
  return state !== null;
}

function rectsOf(segments: TextSegment[], start: number, end: number): DOMRect[] {
  const out: DOMRect[] = [];
  for (const r of slicesToRanges(sliceRange(segments, start, end)))
    for (const rect of r.getClientRects()) if (rect.width > 0 && rect.height > 0) out.push(rect);
  return out;
}

function renderOverlays(entry: PageEntry): void {
  const s = currentSettings;
  for (const b of entry.blocks) {
    const layer = overlayOf(b.el);
    if (!layer) continue;
    layer.replaceChildren();
    if (!s || !b.tokens?.length || (!s.background && !s.furigana?.enabled)) continue;
    const box = b.el.getBoundingClientRect();
    const scale = b.el.offsetWidth ? box.width / b.el.offsetWidth : 1;
    if (!scale || !box.width) continue;
    const vertical = getComputedStyle(b.el).writingMode.startsWith('vertical');
    // overlay origin = text box border-box corner
    const local = (r: DOMRect) => ({
      x: (r.left - box.left) / scale,
      y: (r.top - box.top) / scale,
      w: r.width / scale,
      h: r.height / scale
    });
    const frag = document.createDocumentFragment();
    for (const t of b.tokens) {
      const v = vocab.get(vocabKey(t.w, t.r));
      if (v?.ignored) continue;
      let name = stateToName(t.state);
      if (s.minFrequencyRank > 0 && v && v.freq > 0 && v.freq < s.minFrequencyRank) name = null;
      if (name && s.onlyUnknown && name !== 'jiten-new') name = null;
      if (s.background && name) {
        for (const r of rectsOf(b.segments, t.s, t.e)) {
          const p = local(r);
          const el = document.createElement('span');
          el.className = 'jt';
          el.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;background:var(--${name}-bg)`;
          frag.appendChild(el);
        }
      }
      if (v?.reading && furiganaWanted(t.state, s)) {
        const surface = b.text.slice(t.s, t.e);
        for (const part of furiganaFor(surface, v.reading)) {
          const rects = rectsOf(b.segments, t.s + part.start, t.s + part.end);
          if (!rects.length) continue;
          const p = local(rects[0]);
          const el = document.createElement('span');
          el.className = vertical ? 'furi v' : 'furi';
          el.dataset.rt = part.rt;
          if (vertical) {
            const fs = Math.max(7, p.w * 0.45);
            el.style.cssText = `left:${p.x + p.w}px;top:${p.y}px;height:${p.h}px;font-size:${fs}px`;
          } else {
            const fs = Math.max(7, p.h * 0.45);
            el.style.cssText = `left:${p.x}px;top:${p.y - fs * 1.1}px;width:${p.w}px;font-size:${fs}px`;
          }
          frag.appendChild(el);
        }
      }
    }
    layer.appendChild(frag);
  }
}

/** After the OCR lines were positioned (positionPerLine runs on render), measure in the next frame. */
function scheduleOverlays(entry: PageEntry): void {
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => renderOverlays(entry));
}

export function clearPage(pageKey: string): void {
  const entry = pages.get(pageKey);
  for (const b of entry?.blocks ?? []) overlayOf(b.el)?.replaceChildren();
  if (pages.delete(pageKey)) rebuildRegistry();
}

export function clearAll(): void {
  for (const entry of pages.values())
    for (const b of entry.blocks) overlayOf(b.el)?.replaceChildren();
  pages.clear();
  rebuildRegistry();
}

/** Drop cached tokens (after overrides/mining changed states) and re-run every mounted page. */
export function invalidate(): void {
  tokenCache.clear();
  cooldownUntil = 0;
  for (const [key, entry] of pages)
    void highlightPage(
      key,
      entry.blocks.map((b) => b.el)
    );
}

function rebuildRegistry(): void {
  if (!highlightsSupported()) return;
  const reg = CSS.highlights;
  for (const name of HIGHLIGHT_NAMES) {
    const ranges: Range[] = [];
    if (currentSettings?.enabled)
      for (const p of pages.values()) ranges.push(...(p.ranges.get(name) ?? []));
    if (ranges.length === 0) reg.delete(name);
    else reg.set(name, new Highlight(...ranges));
  }
}

/** Find the token under a client point (for the word popup). */
export function tokenAtPoint(
  x: number,
  y: number,
  slop = 2
): { token: ParsedToken; vocab: VocabEntry | undefined; text: string; range: Range } | null {
  for (const p of pages.values()) {
    for (const h of p.hits) {
      for (const rect of Array.from(h.range.getClientRects())) {
        if (
          x >= rect.left - slop &&
          x <= rect.right + slop &&
          y >= rect.top - slop &&
          y <= rect.bottom + slop
        ) {
          return {
            token: h.token,
            vocab: vocab.get(vocabKey(h.token.w, h.token.r)),
            text: h.range.toString(),
            range: h.range
          };
        }
      }
    }
  }
  return null;
}

/** First token on any mounted page whose rendered text equals `text` (maps a captured selection to a word). */
export function findHitByText(
  text: string
): { token: ParsedToken; vocab: VocabEntry | undefined } | null {
  for (const p of pages.values()) {
    for (const h of p.hits) {
      if (h.range.toString() === text)
        return { token: h.token, vocab: vocab.get(vocabKey(h.token.w, h.token.r)) };
    }
  }
  return null;
}

/**
 * Tap-to-popup: a plain click/tap on a highlighted word (no text selection in progress, not on the popup
 * itself) opens the word popup; a tap anywhere else closes it. Installed by FamiliarityPopup.
 */
export function installTapHandler(): () => void {
  const onClick = (e: MouseEvent) => {
    if (!currentSettings?.enabled || currentSettings.popup === false) return;
    const target = e.target as Element | null;
    if (!target || target.closest('[data-jiten-popup]')) return;
    const box = target.closest('.textBox') as HTMLElement | null;
    if (!box) {
      popupWord.set(null);
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // the user is selecting text (dictionary extensions)
    const hit = tokenAtPoint(e.clientX, e.clientY);
    if (!hit) {
      popupWord.set(null);
      return;
    }
    popupWord.set({ ...hit, box, x: e.clientX, y: e.clientY });
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

export function currentWarning(): string | null {
  return get(familiarityWarning);
}

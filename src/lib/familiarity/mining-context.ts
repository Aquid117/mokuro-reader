import { findHitByText, invalidate } from './engine';
import { familiarityApi } from './api';
import type { ParsedToken, VocabEntry } from './types';

/**
 * Bridges Jiten data into the reader's Anki templates.
 * `{jiten_reading} {jiten_meaning} {jiten_frequency} {jiten_pitch} {jiten_id} {jiten_spelling}` resolve
 * from the word the user tapped in the popup (explicit) or, failing that, from the token whose rendered
 * text equals the captured selection.
 */
interface MiningWord {
  token: ParsedToken;
  entry: VocabEntry;
  text: string;
  at: number;
}
let explicit: MiningWord | null = null;
const EXPLICIT_TTL = 5 * 60_000;

export function setMiningWord(token: ParsedToken, entry: VocabEntry, text: string): void {
  explicit = { token, entry, text, at: Date.now() };
}

export function clearMiningWord(): void {
  explicit = null;
}

function lookup(text?: string): MiningWord | null {
  const t = text?.trim();
  if (explicit && Date.now() - explicit.at < EXPLICIT_TTL && (!t || explicit.text === t))
    return explicit;
  if (!t) return null;
  const hit = findHitByText(t);
  return hit?.vocab ? { token: hit.token, entry: hit.vocab, text: t, at: Date.now() } : null;
}

/** "約[やく]束[そく]" → "やくそく"; plain kana passes through. */
export function readingToKana(ruby: string): string {
  return ruby.replace(/[^[\]]+?\[([^\]]+)\]/g, '$1');
}

export function formatMeaning(meanings: string[][], maxSenses = 3, maxGlosses = 4): string {
  return meanings
    .slice(0, maxSenses)
    .map((sense) => sense.slice(0, maxGlosses).join('; '))
    .join(' | ');
}

export function jitenTemplateVars(text?: string): Record<string, string> {
  const m = lookup(text);
  if (!m)
    return {
      jiten_reading: '',
      jiten_meaning: '',
      jiten_frequency: '',
      jiten_pitch: '',
      jiten_id: '',
      jiten_spelling: ''
    };
  return {
    jiten_reading: readingToKana(m.entry.reading),
    jiten_meaning: formatMeaning(m.entry.meanings),
    jiten_frequency: m.entry.freq > 0 ? String(m.entry.freq) : '',
    jiten_pitch: m.entry.pitch.join(','),
    jiten_id: String(m.token.w),
    jiten_spelling: m.entry.spelling
  };
}

export function applyJitenTemplateVars(template: string, text?: string): string {
  if (!template.includes('{jiten_')) return template;
  const vars = jitenTemplateVars(text);
  return template.replace(/\{(jiten_[a-z]+)\}/g, (_m, k: string) => vars[k] ?? '');
}

/** After a card was created: remember the word as mined (underline) on the server. */
export async function onNoteAdded(text: string | undefined, noteId: number | null): Promise<void> {
  const m = lookup(text);
  if (!m) return;
  try {
    await familiarityApi.recordMined(m.token.w, m.token.r, noteId);
    invalidate();
  } catch {
    // non-fatal: the card exists; the underline will appear after the next refresh
  }
  explicit = null;
}

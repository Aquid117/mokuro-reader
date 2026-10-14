import type { ExplanationData } from './api';

/**
 * manga-immersion fork: the AI explanation of a bubble as a compact block for the card's Notes field.
 * The block is wrapped in <!--ai--> markers so it can be replaced later without touching anything
 * else the user wrote into Notes.
 */
const START = '<!--ai-->';
const END = '<!--/ai-->';

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildAiNotes(ex: ExplanationData, maxGrammar = 4): string {
  const parts: string[] = [];
  if (ex.translation) parts.push(`<div><b>Translation:</b> ${esc(ex.translation)}</div>`);
  if (ex.literal && ex.literal !== ex.translation)
    parts.push(`<div><i>Literal:</i> ${esc(ex.literal)}</div>`);
  const grammar = ex.grammar.slice(0, maxGrammar).map((g) => {
    const cmp = [g.german ? `DE: ${esc(g.german)}` : '', g.russian ? `RU: ${esc(g.russian)}` : '']
      .filter(Boolean)
      .join(' · ');
    return `<li><b>${esc(g.pattern)}</b> ${esc(g.explanation)}${cmp ? `<br><small>${cmp}</small>` : ''}</li>`;
  });
  if (grammar.length) parts.push(`<ul>${grammar.join('')}</ul>`);
  return `${START}<div class="mm-ai">${parts.join('')}</div>${END}`;
}

/** Puts `block` into `existing` Notes: replaces an earlier AI block, else appends after the user's text. */
export function mergeAiNotes(existing: string, block: string): string {
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s >= 0 && e > s) return existing.slice(0, s) + block + existing.slice(e + END.length);
  return existing.trim() ? `${existing}<br>${block}` : block;
}

export function hasAiNotes(notes: string): boolean {
  return notes.includes(START);
}

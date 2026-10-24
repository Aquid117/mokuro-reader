import { get } from 'svelte/store';
import { settings } from '$lib/settings';
import { ankiConnect } from '$lib/anki-connect';
import { showSnackbar } from '$lib/util';
import { bubbleInBitmap, cropRect, encodeCrop, type CropMode, type Rect } from './panel-crop';
import { requestMinePreview } from './mine-preview';
import { aiApi } from '$lib/ai/api';
import { buildAiNotes } from '$lib/ai/anki-notes';
import { onNoteAdded, setMiningWord, readingToKana } from './mining-context';
import { ankiSync, refreshAnkiSync } from './anki-sync';
import type { ParsedToken, VocabEntry } from './types';

/**
 * One-tap mining (manga-immersion fork): builds a "Manga Mining" note from the tapped word — dictionary
 * form, reading, Anki furigana, Jiten glosses, the sentence with the word in bold, a panel-sized image,
 * source and page — and adds it through the server's AnkiConnect bridge without opening an editor.
 */
export interface QuickMineInput {
  token: ParsedToken;
  vocab: VocabEntry | undefined;
  surface: string;
  blockText: string;
  imageBlob: Blob | null;
  bubble: Rect; // OCR box in page (img_width/img_height) pixels
  pageSize: { width: number; height: number };
  pageNumber: number;
  seriesTitle?: string;
  volumeTitle?: string;
  /** link stored in SourceURL (default: the current page) */
  sourceUrl?: string;
}

const KANJI = '\\u3400-\\u9fff\\uf900-\\ufaff々〆ヶ';

/**
 * Jiten ruby "取[と]り消[け]す" → Anki furigana "取[と]り 消[け]す": Anki's {{furigana:}} takes every
 * non-space character before "[" as the base, so a space must separate kana from the next kanji group.
 */
export function toAnkiFurigana(ruby: string): string {
  if (!ruby.includes('[')) return '';
  return ruby.replace(new RegExp(`([^\\s\\]])([${KANJI}]+\\[)`, 'g'), '$1 $2').trim();
}

const SENTENCE_END = /[。！？!?…‥\n]/;
const CLOSERS = /[」』）)】〉》"'”’]/;

/** Sentence around [s, e) within a text box's concatenated text, with the word marked in <b>. */
export function sentenceAround(
  text: string,
  s: number,
  e: number
): { plain: string; html: string } {
  let start = s;
  while (start > 0 && !SENTENCE_END.test(text[start - 1])) start--;
  while (start < s && /[\s」』）)]/.test(text[start])) start++;
  let end = e;
  while (end < text.length && !SENTENCE_END.test(text[end])) end++;
  while (end < text.length && SENTENCE_END.test(text[end])) end++; // keep 。！？… runs
  while (end < text.length && CLOSERS.test(text[end])) end++;
  const before = text.slice(start, s);
  const word = text.slice(s, e);
  const after = text.slice(e, end);
  return { plain: before + word + after, html: `${esc(before)}<b>${esc(word)}</b>${esc(after)}` };
}

export function formatMeaningHtml(meanings: string[][], maxSenses = 4, maxGlosses = 5): string {
  const senses = meanings.slice(0, maxSenses).map((g) => esc(g.slice(0, maxGlosses).join('; ')));
  if (senses.length <= 1) return senses[0] ?? '';
  return senses.map((m, i) => `${i + 1}. ${m}`).join('<br>');
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tagify(t?: string): string {
  return (t ?? '').trim().replace(/\s+/g, '_').replace(/[:"]/g, '');
}

export function buildMangaFields(input: QuickMineInput, readerUrl: string): Record<string, string> {
  const v = input.vocab;
  const word = v?.spelling || input.surface;
  const { html } = sentenceAround(input.blockText, input.token.s, input.token.e);
  const source = [
    input.seriesTitle,
    input.volumeTitle && input.volumeTitle !== input.seriesTitle ? input.volumeTitle : ''
  ]
    .filter(Boolean)
    .join(' — ');
  return {
    Word: esc(word),
    Reading: v ? esc(readingToKana(v.reading)) : '',
    Furigana: v ? esc(toAnkiFurigana(v.reading)) : '',
    Meaning: v ? formatMeaningHtml(v.meanings) : '',
    Sentence: html,
    Frequency: v && v.freq > 0 ? String(v.freq) : '',
    Pitch: v?.pitch?.length ? v.pitch.join(',') : '',
    Source: esc(source),
    Page: String(input.pageNumber),
    SourceURL: readerUrl,
    JMDictID: String(input.token.w),
    Notes: ''
  };
}

let busy = false;

export async function quickMine(input: QuickMineInput): Promise<boolean> {
  if (busy) return false;
  const all = get(settings);
  if (!all.ankiConnectSettings.enabled) {
    showSnackbar('Enable AnkiConnect in the settings first');
    return false;
  }
  const mining = all.familiarity.mining;
  // "4 Mining::Manga Mining" → "Manga Mining" in the preview button and the confirmation
  const deckLabel = mining.deck.split('::').pop() || mining.deck;
  busy = true;
  try {
    if (input.vocab) setMiningWord(input.token, input.vocab, input.surface);
    const fields = buildMangaFields(
      input,
      input.sourceUrl ?? location.origin + location.pathname + location.hash
    );
    const note: Record<string, unknown> = {
      deckName: mining.deck,
      modelName: mining.model,
      fields,
      tags: ['manga', 'mokuro', tagify(input.seriesTitle)].filter(Boolean),
      options: { allowDuplicate: false, duplicateScope: 'collection' }
    };
    if (input.imageBlob) {
      let bitmap: ImageBitmap | null = null;
      let imageUrl: string | null = null;
      try {
        bitmap = await createImageBitmap(input.imageBlob);
        const bubble = bubbleInBitmap(input.bubble, input.pageSize, bitmap);
        let rect = await cropRect(bitmap, bubble, mining.image as CropMode);
        if (mining.preview !== false) {
          imageUrl = URL.createObjectURL(input.imageBlob);
          const chosen = await requestMinePreview({
            imageUrl,
            bitmap,
            bubble,
            rect,
            mode: mining.image as CropMode,
            word: fields.Word,
            reading: fields.Reading,
            sentenceHtml: fields.Sentence,
            deck: deckLabel
          });
          if (!chosen) return false; // cancelled: no card
          rect = chosen;
        }
        const data = await encodeCrop(bitmap, rect);
        note.picture = [
          { filename: `manga_${Date.now()}_${input.token.w}.jpg`, data, fields: ['Picture'] }
        ];
      } catch (e) {
        console.warn('image crop failed, adding the card without a picture', e);
      } finally {
        bitmap?.close();
        if (imageUrl) URL.revokeObjectURL(imageUrl);
      }
    }
    // AI explanation of this bubble (if one was requested before) goes into Notes
    if (mining.aiNotes !== false) {
      const ai = await Promise.race([
        aiApi.forBubble(input.blockText).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 2000))
      ]);
      if (ai?.result) fields.Notes = buildAiNotes(ai.result.explanation);
    }
    const result = await ankiConnect('addNote', { note }, { silent: true });
    if (typeof result === 'number') {
      // status may not be loaded yet on the first card; the server default is 2 min
      const auto = get(ankiSync).status?.autoSync ?? { enabled: true, afterMiningSec: 120 };
      const when = auto.enabled
        ? ` · AnkiWeb sync in ~${Math.max(1, Math.round(auto.afterMiningSec / 60))} min`
        : '';
      showSnackbar(`Added ${fields.Word} to ${deckLabel}${when}`, 4000);
      void refreshAnkiSync();
      void onNoteAdded(input.surface, result, input.blockText);
      return true;
    }
    // ankiConnect swallows errors in silent mode; ask why via canAddNotesWithErrorDetail
    const check = await ankiConnect(
      'canAddNotesWithErrorDetail',
      { notes: [{ ...note, picture: undefined }] },
      { silent: true }
    );
    const reason =
      Array.isArray(check) && check[0]?.error ? String(check[0].error) : 'unknown error';
    showSnackbar(
      /duplicate/i.test(reason)
        ? `Already in Anki: ${fields.Word}`
        : `Could not add card: ${reason}`
    );
    return false;
  } finally {
    busy = false;
  }
}

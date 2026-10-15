/**
 * manga-immersion fork: furigana from Jiten readings. Jiten gives the dictionary form as ruby, split per
 * kanji group ("取[と]り消[け]す"); the text may be inflected ("取り消した"), so readings are matched to the
 * kanji groups of the surface text by identical kanji, not by position in the word.
 */
const KANJI = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff々〆ヶ';
const RUBY_RE = new RegExp(`([${KANJI}]+)\\[([^\\]]+)\\]`, 'g');
const RUN_RE = new RegExp(`[${KANJI}]+`, 'g');

export interface RubyPair {
  base: string;
  rt: string;
}

export function parseRuby(ruby: string): RubyPair[] {
  const out: RubyPair[] = [];
  for (const m of ruby.matchAll(RUBY_RE)) out.push({ base: m[1], rt: m[2] });
  return out;
}

export interface FuriganaPart {
  /** offsets inside the surface text */
  start: number;
  end: number;
  rt: string;
}

/** Readings for each kanji group of `surface`; groups without an identical base in the ruby get none. */
export function furiganaFor(surface: string, ruby: string): FuriganaPart[] {
  const pairs = parseRuby(ruby);
  if (!pairs.length) return [];
  const used = new Set<number>();
  const out: FuriganaPart[] = [];
  for (const m of surface.matchAll(RUN_RE)) {
    const run = m[0];
    const start = m.index ?? 0;
    const i = pairs.findIndex((p, k) => !used.has(k) && p.base === run);
    if (i >= 0) {
      used.add(i);
      out.push({ start, end: start + run.length, rt: pairs[i].rt });
      continue;
    }
    // a run made of several ruby groups in a row (e.g. "日本語" as 日[に]本[ほん]語[ご])
    let pos = 0;
    const parts: FuriganaPart[] = [];
    for (let k = 0; k < pairs.length && pos < run.length; k++) {
      if (used.has(k) || !run.startsWith(pairs[k].base, pos)) continue;
      parts.push({ start: start + pos, end: start + pos + pairs[k].base.length, rt: pairs[k].rt });
      used.add(k);
      pos += pairs[k].base.length;
    }
    if (pos === run.length) out.push(...parts);
  }
  return out;
}

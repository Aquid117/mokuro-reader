// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { collectTextSegments, blockText, sliceRange } from './offsets';

function box(lines: string[], perLine = true): HTMLElement {
  const div = document.createElement('div');
  div.className = 'textBox' + (perLine ? ' perLine' : '');
  const p = document.createElement('p');
  for (const l of lines) {
    const span = document.createElement('span');
    span.className = 'ocr-line' + (perLine ? ' positionedLine' : '');
    span.textContent = l;
    p.appendChild(span);
  }
  div.appendChild(p);
  return div;
}

const SENTENCE = '昨日、友達と約束したけど、忘れちゃった。';

describe('offset mapping', () => {
  it('concatenates OCR lines without separators (vertical text wraps mid-word)', () => {
    const el = box(['昨日、友達と約', '束したけど、', '忘れちゃった。']);
    const segs = collectTextSegments(el);
    expect(segs.map((s) => [s.start, s.length])).toEqual([
      [0, 7],
      [7, 6],
      [13, 7]
    ]);
    expect(blockText(segs)).toBe(SENTENCE);
  });

  it('slices a word that spans two lines into two node slices', () => {
    const el = box(['昨日、友達と約', '束したけど、', '忘れちゃった。']);
    const segs = collectTextSegments(el);
    const yakusoku = SENTENCE.indexOf('約束');
    const slices = sliceRange(segs, yakusoku, yakusoku + 2);
    expect(slices.map((s) => [s.node.data, s.start, s.end])).toEqual([
      ['昨日、友達と約', 6, 7],
      ['束したけど、', 0, 1]
    ]);
    expect(slices.map((s) => s.node.data.slice(s.start, s.end)).join('')).toBe('約束');
  });

  it('keeps punctuation and conjugated forms aligned', () => {
    const el = box(['昨日、友達と約束したけど、忘れちゃった。']);
    const segs = collectTextSegments(el);
    const s = SENTENCE.indexOf('忘れちゃった');
    const slices = sliceRange(segs, s, s + 6);
    expect(slices).toHaveLength(1);
    expect(slices[0].node.data.slice(slices[0].start, slices[0].end)).toBe('忘れちゃった');
    expect(sliceRange(segs, 2, 3)[0].node.data.slice(2, 3)).toBe('、');
  });

  it('counts UTF-16 code units like the Jiten API (surrogate pairs are two units)', () => {
    const el = box(['𠮟る', 'とき']);
    const segs = collectTextSegments(el);
    expect(blockText(segs)).toBe('𠮟るとき');
    expect(segs[1].start).toBe(3); // 𠮟 is 2 code units + る
    const toki = sliceRange(segs, 3, 5);
    expect(toki[0].node.data.slice(toki[0].start, toki[0].end)).toBe('とき');
  });

  it('handles legacy blocks rendered without per-line layout', () => {
    const el = box(['一行目', '二行目'], false);
    const segs = collectTextSegments(el);
    expect(blockText(segs)).toBe('一行目二行目');
    expect(sliceRange(segs, 3, 6)[0].node.data).toBe('二行目');
  });

  it('ignores ranges outside the text and empty ranges', () => {
    const segs = collectTextSegments(box(['abc']));
    expect(sliceRange(segs, 5, 9)).toEqual([]);
    expect(sliceRange(segs, 2, 2)).toEqual([]);
    expect(sliceRange(segs, 1, 10).map((s) => [s.start, s.end])).toEqual([[1, 3]]);
  });

  it('skips elements whose lines are hidden (not rendered)', () => {
    const el = box(['見える', '見えない'], true);
    el.querySelectorAll('.ocr-line')[1].remove();
    expect(blockText(collectTextSegments(el))).toBe('見える');
  });
});

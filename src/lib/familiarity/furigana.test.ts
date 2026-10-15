import { describe, it, expect } from 'vitest';
import { furiganaFor, parseRuby } from './furigana';

describe('furigana from Jiten ruby', () => {
  it('parses kanji groups', () => {
    expect(parseRuby('取[と]り消[け]す')).toEqual([
      { base: '取', rt: 'と' },
      { base: '消', rt: 'け' }
    ]);
    expect(parseRuby('いいよ')).toEqual([]);
  });

  it('matches inflected surfaces by kanji', () => {
    expect(furiganaFor('取り消した', '取[と]り消[け]す')).toEqual([
      { start: 0, end: 1, rt: 'と' },
      { start: 2, end: 3, rt: 'け' }
    ]);
    expect(furiganaFor('今日', '今日[きょう]')).toEqual([{ start: 0, end: 2, rt: 'きょう' }]);
    expect(furiganaFor('先輩', '先[せん]輩[ぱい]')).toEqual([
      { start: 0, end: 1, rt: 'せん' },
      { start: 1, end: 2, rt: 'ぱい' }
    ]);
  });

  it('skips groups it cannot match and kana-only words', () => {
    expect(furiganaFor('とりけす', '取[と]り消[け]す')).toEqual([]);
    expect(furiganaFor('嬉しい', '嬉[うれ]しい')).toEqual([{ start: 0, end: 1, rt: 'うれ' }]);
    expect(furiganaFor('悦しい', '嬉[うれ]しい')).toEqual([]);
  });
});

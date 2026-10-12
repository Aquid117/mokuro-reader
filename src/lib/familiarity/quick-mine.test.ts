import { describe, it, expect, vi } from 'vitest';
vi.mock('$lib/anki-connect', () => ({ ankiConnect: vi.fn() }));
vi.mock('$lib/util', () => ({ showSnackbar: vi.fn() }));
import { toAnkiFurigana, sentenceAround, formatMeaningHtml, buildMangaFields } from './quick-mine';

describe('quick mine helpers', () => {
  it('converts Jiten ruby to Anki furigana', () => {
    expect(toAnkiFurigana('約[やく]束[そく]')).toBe('約[やく]束[そく]');
    expect(toAnkiFurigana('取[と]り消[け]す')).toBe('取[と]り 消[け]す');
    expect(toAnkiFurigana('お茶[ちゃ]')).toBe('お 茶[ちゃ]');
    expect(toAnkiFurigana('忘[わす]れる')).toBe('忘[わす]れる');
    expect(toAnkiFurigana('けど')).toBe('');
    expect(toAnkiFurigana('突[つ]っ走[ぱし]る')).toBe('突[つ]っ 走[ぱし]る');
  });

  it('extracts the sentence around a word and bolds it', () => {
    const t = '昨日、友達と約束したけど、忘れちゃった。また今度ね！';
    const s = t.indexOf('約束');
    expect(sentenceAround(t, s, s + 2)).toEqual({
      plain: '昨日、友達と約束したけど、忘れちゃった。',
      html: '昨日、友達と<b>約束</b>したけど、忘れちゃった。'
    });
    const k = t.indexOf('今度');
    expect(sentenceAround(t, k, k + 2).plain).toBe('また今度ね！');
  });

  it('keeps closing quotes with the sentence', () => {
    const t = '「部活中のプレーが納得いかなくて…」';
    const s = t.indexOf('プレー');
    expect(sentenceAround(t, s, s + 3).plain).toBe('「部活中のプレーが納得いかなくて…」');
  });

  it('numbers multiple senses', () => {
    expect(formatMeaningHtml([['promise', 'agreement'], ['appointment']])).toBe(
      '1. promise; agreement<br>2. appointment'
    );
    expect(formatMeaningHtml([['basketball']])).toBe('basketball');
  });

  it('builds the Manga Mining fields', () => {
    const text = '部活中のプレーが納得いかなくて';
    const f = buildMangaFields(
      {
        token: { s: 0, e: 2, w: 1622100, r: 0, state: 'new' },
        vocab: {
          spelling: '部活',
          reading: '部[ぶ]活[かつ]',
          meanings: [['club activities']],
          pos: [],
          freq: 4276,
          pitch: [0],
          jiten: [0],
          override: null,
          mined: false
        },
        surface: '部活',
        blockText: text,
        imageBlob: null,
        bubble: [0, 0, 1, 1],
        pageSize: { width: 1, height: 1 },
        pageNumber: 33,
        seriesTitle: 'Ao no Hako',
        volumeTitle: 'アオのハコ 01'
      },
      'https://manga.example/#/reader/x/y'
    );
    expect(f).toMatchObject({
      Word: '部活',
      Reading: 'ぶかつ',
      Furigana: '部[ぶ]活[かつ]',
      Meaning: 'club activities',
      Sentence: '<b>部活</b>中のプレーが納得いかなくて',
      Frequency: '4276',
      Pitch: '0',
      Source: 'Ao no Hako — アオのハコ 01',
      Page: '33',
      SourceURL: 'https://manga.example/#/reader/x/y',
      JMDictID: '1622100'
    });
  });
});

import { describe, it, expect } from 'vitest';
import { blockText, contextFromPage } from './context';
import { readSse } from './api';
import { renderMarkdown } from './markdown';
import type { Page } from '$lib/types';

function page(texts: string[][]): Page {
  return {
    img_width: 1000,
    img_height: 1500,
    img_path: 'p.jpg',
    version: '0.2',
    blocks: texts.map((lines) => ({
      box: [0, 0, 10, 10],
      vertical: true,
      font_size: 20,
      lines,
      lines_coords: []
    }))
  } as unknown as Page;
}

describe('AI context', () => {
  it('joins OCR lines without separators', () => {
    expect(blockText(['今日は ', ' いい天気'])).toBe('今日はいい天気');
  });

  it('takes up to three non-empty neighbours on each side', () => {
    const p = page([['a'], ['b'], [''], ['c'], ['FOCUS'], ['d'], ['e'], ['f'], ['g']]);
    const ctx = contextFromPage(p, 4, { series: 'S', page: 7, focusWord: 'F' });
    expect(ctx.text).toBe('FOCUS');
    expect(ctx.before).toEqual(['b', 'c']);
    expect(ctx.after).toEqual(['d', 'e', 'f']);
    expect(ctx).toMatchObject({ series: 'S', page: 7, focusWord: 'F', volume: undefined });
  });
});

function streamOf(text: string, step = 4): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += step) c.enqueue(bytes.slice(i, i + step));
      c.close();
    }
  });
}

describe('readSse', () => {
  it('parses named events across chunk boundaries', async () => {
    const events: { event: string; data: string }[] = [];
    await readSse(
      streamOf(
        'event: delta\ndata: "は"\n\nevent: delta\r\ndata: "い"\r\n\r\nevent: done\ndata: {}\n\n'
      ),
      (e) => events.push(e)
    );
    expect(events).toEqual([
      { event: 'delta', data: '"は"' },
      { event: 'delta', data: '"い"' },
      { event: 'done', data: '{}' }
    ]);
  });
});

describe('renderMarkdown', () => {
  it('escapes HTML and renders a safe subset', () => {
    const html = renderMarkdown('**て-form** + しまう\n\n- one\n- <b>two</b>\n\nuse `だ`');
    expect(html).toBe(
      '<p><strong>て-form</strong> + しまう</p><ul><li>one</li><li>&lt;b&gt;two&lt;/b&gt;</li></ul><p>use <code>だ</code></p>'
    );
  });
});

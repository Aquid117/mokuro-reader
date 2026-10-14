import { describe, it, expect } from 'vitest';
import { buildAiNotes, mergeAiNotes, hasAiNotes } from './anki-notes';
import type { ExplanationData } from './api';

const ex: ExplanationData = {
  translation: "That's why I like you.",
  literal: 'Therefore [I] like.',
  register: 'casual',
  breakdown: [],
  grammar: [
    {
      pattern: '〜んだ',
      inText: 'なんだ',
      explanation: 'explanatory <emphasis>',
      german: 'eben',
      russian: null
    }
  ],
  notes: [],
  ocrSuspect: null
};

describe('AI notes for Anki', () => {
  it('builds an escaped, marked block with translation and grammar', () => {
    const html = buildAiNotes(ex);
    expect(html.startsWith('<!--ai-->')).toBe(true);
    expect(html).toContain("<b>Translation:</b> That's why I like you.");
    expect(html).toContain('<b>〜んだ</b> explanatory &lt;emphasis&gt;');
    expect(html).toContain('DE: eben');
    expect(hasAiNotes(html)).toBe(true);
  });

  it('appends to user notes and replaces an earlier AI block', () => {
    const first = mergeAiNotes('my note', buildAiNotes(ex));
    expect(first.startsWith('my note<br><!--ai-->')).toBe(true);
    const second = mergeAiNotes(first, buildAiNotes({ ...ex, translation: 'New' }));
    expect(second).toContain('my note');
    expect(second).toContain('<b>Translation:</b> New');
    expect(second.match(/<!--ai-->/g)).toHaveLength(1);
    expect(mergeAiNotes('', '<!--ai-->x<!--/ai-->')).toBe('<!--ai-->x<!--/ai-->');
  });
});

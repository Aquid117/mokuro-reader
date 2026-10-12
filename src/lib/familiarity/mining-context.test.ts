import { describe, it, expect } from 'vitest';
import { readingToKana, formatMeaning, applyJitenTemplateVars } from './mining-context';

describe('mining context helpers', () => {
  it('turns Jiten ruby readings into kana', () => {
    expect(readingToKana('約[やく]束[そく]')).toBe('やくそく');
    expect(readingToKana('友[とも]達[だち]')).toBe('ともだち');
    expect(readingToKana('けど')).toBe('けど');
    expect(readingToKana('忘[わす]れる')).toBe('わすれる');
  });
  it('formats meanings compactly', () => {
    expect(formatMeaning([['promise', 'agreement'], ['appointment']])).toBe(
      'promise; agreement | appointment'
    );
  });
  it('resolves jiten variables to empty strings when no word is known', () => {
    expect(applyJitenTemplateVars('{jiten_reading}|{jiten_id}', '約束')).toBe('|');
    expect(applyJitenTemplateVars('plain', '約束')).toBe('plain');
  });
});

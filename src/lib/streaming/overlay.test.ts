import { describe, it, expect } from 'vitest';
import { mergeStreamOverlay, setOverlay, dropOverlay } from './overlay';

const f = (name: string, size: number) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

describe('stream overlay', () => {
  it('leaves volumes that never streamed untouched', () => {
    const files = { 'a.jpg': f('a.jpg', 1) };
    expect(mergeStreamOverlay('other', files)).toBe(files);
  });

  it('replaces placeholders with fetched pages and keeps File identity for unchanged pages', () => {
    const placeholder = f('p2.jpg', 10);
    const page1 = f('v/p1.jpg', 100);
    setOverlay('u1', {
      pageToEntry: new Map([
        ['v/p2.jpg', 'v/p2.jpg'],
        ['v/p3.jpg', 'v/p3.webp']
      ]),
      fetched: new Map()
    });
    const first = mergeStreamOverlay('u1', {
      'v/p1.jpg': page1,
      'v/p2.jpg': placeholder,
      'v/p3.jpg': f('p3.jpg', 10)
    })!;
    expect(first['v/p2.jpg']).toBe(placeholder);

    // a batch arrives; the DB reload hands in NEW File objects with the same content
    const real3 = f('v/p3.webp', 300);
    setOverlay('u1', {
      pageToEntry: new Map([
        ['v/p2.jpg', 'v/p2.jpg'],
        ['v/p3.jpg', 'v/p3.webp']
      ]),
      fetched: new Map([['v/p3.webp', real3]])
    });
    const second = mergeStreamOverlay('u1', {
      'v/p1.jpg': f('v/p1.jpg', 100),
      'v/p2.jpg': f('p2.jpg', 10),
      'v/p3.jpg': f('p3.jpg', 10)
    })!;
    expect(second['v/p1.jpg']).toBe(page1); // same object → no re-decode
    expect(second['v/p2.jpg']).toBe(placeholder);
    expect(second['v/p3.jpg']).toBeUndefined();
    expect(second['v/p3.webp']).toBe(real3);

    // completion: stored map now has real files; identities still reused
    dropOverlay('u1');
    const done = mergeStreamOverlay('u1', {
      'v/p1.jpg': f('v/p1.jpg', 100),
      'v/p2.jpg': f('p2.jpg', 10),
      'v/p3.webp': f('v/p3.webp', 300)
    })!;
    expect(done['v/p1.jpg']).toBe(page1);
    expect(done['v/p3.webp']).toBe(real3);
  });
});

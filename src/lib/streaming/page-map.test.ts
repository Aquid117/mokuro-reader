import { describe, it, expect } from 'vitest';
import { mapPagesToEntries } from './page-map';

describe('mapPagesToEntries', () => {
  it('matches exact paths, archive-root differences and extension changes', () => {
    const pages = ['Vol 01/001.jpg', 'Vol 01/002.jpg', 'Vol 01/003.jpg'];
    expect(
      mapPagesToEntries(pages, ['Vol 01/003.jpg', 'Vol 01/001.jpg', 'Vol 01/002.jpg'])
    ).toEqual([1, 2, 0]);
    expect(
      mapPagesToEntries(pages, [
        'root/Vol 01/001.jpg',
        'root/Vol 01/002.jpg',
        'root/Vol 01/003.jpg'
      ])
    ).toEqual([0, 1, 2]);
    expect(
      mapPagesToEntries(pages, ['Vol 01/001.webp', 'Vol 01/002.webp', 'Vol 01/003.webp'])
    ).toEqual([0, 1, 2]);
  });
  it('falls back to natural order when names are unrelated but counts match', () => {
    expect(mapPagesToEntries(['a.jpg', 'b.jpg'], ['p10.jpg', 'p9.jpg'])).toEqual([1, 0]);
  });
  it('marks pages without an image as -1', () => {
    expect(mapPagesToEntries(['x/1.jpg', 'x/2.jpg', 'x/3.jpg'], ['x/1.jpg', 'x/3.jpg'])).toEqual([
      0, -1, 1
    ]);
  });
});

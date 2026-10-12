/**
 * Map OCR pages (mokuro img_path) to archive entries — the same strategy as the importer's
 * matchImagesToPages: exact normalized path, then stem (extension changed), then positional when the
 * counts match. Returns, per page index, the index into `entryNames` or -1.
 */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
function stem(p: string): string {
  const base = norm(p).split('/').pop() ?? '';
  return base.replace(/\.[^.]+$/, '');
}
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function mapPagesToEntries(pagePaths: string[], entryNames: string[]): number[] {
  const byPath = new Map<string, number>();
  const byTail = new Map<string, number>();
  const byStem = new Map<string, number>();
  entryNames.forEach((n, i) => {
    const p = norm(n);
    byPath.set(p, i);
    const parts = p.split('/');
    byTail.set(parts.slice(-2).join('/'), i);
    if (!byStem.has(stem(n))) byStem.set(stem(n), i);
  });
  const used = new Set<number>();
  const out = pagePaths.map((pp) => {
    const p = norm(pp);
    let i = byPath.get(p) ?? byTail.get(p.split('/').slice(-2).join('/'));
    if (i === undefined) i = byStem.get(stem(pp));
    if (i === undefined || used.has(i)) return -1;
    used.add(i);
    return i;
  });
  const missing = out.filter((i) => i < 0).length;
  if (missing > 0 && missing > pagePaths.length / 2) {
    // positional fallback: same number of images as pages, names unrelated
    const sorted = entryNames.map((n, i) => ({ n, i })).sort((a, b) => natural.compare(a.n, b.n));
    if (sorted.length === pagePaths.length) return sorted.map((s) => s.i);
  }
  return out;
}

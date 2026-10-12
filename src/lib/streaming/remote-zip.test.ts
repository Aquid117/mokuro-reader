import { describe, it, expect } from 'vitest';
import { BlobWriter, ZipWriter, Uint8ArrayReader, configure } from '@zip.js/zip.js';
import { RemoteZip } from './remote-zip';

configure({ useWebWorkers: false });

async function buildZip(files: Record<string, Uint8Array>, level = 0): Promise<Uint8Array> {
  const w = new ZipWriter(new BlobWriter('application/zip'));
  for (const [name, data] of Object.entries(files))
    await w.add(name, new Uint8ArrayReader(data), { level });
  const blob = await w.close();
  return new Uint8Array(await blob.arrayBuffer());
}

function rangeServer(zip: Uint8Array, log: string[]) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (init?.method === 'HEAD') {
      log.push('HEAD');
      return new Response(null, { status: 200, headers: { 'content-length': String(zip.length) } });
    }
    const m = /bytes=(\d+)-(\d+)/.exec(h.Range ?? '');
    if (!m) return new Response(zip as BlobPart, { status: 200 });
    const a = Number(m[1]);
    const b = Math.min(zip.length - 1, Number(m[2]));
    log.push(`${a}-${b}`);
    return new Response(zip.slice(a, b + 1) as BlobPart, { status: 206 });
  }) as typeof fetch;
}

const page = (n: number, size = 300_000) => {
  const a = new Uint8Array(size);
  for (let i = 0; i < size; i++) a[i] = (i * 31 + n) & 255;
  return a;
};

describe('RemoteZip', () => {
  it('lists entries from the central directory and reads stored pages by range', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 12; i++) files[`Vol 01/${String(i).padStart(3, '0')}.jpg`] = page(i);
    files['Vol 01.mokuro'] = new TextEncoder().encode('{"pages":[]}');
    const zip = await buildZip(files);
    const log: string[] = [];
    const rz = await new RemoteZip(
      'https://x/vol.cbz',
      { Authorization: 'Bearer t' },
      rangeServer(zip, log)
    ).open();
    expect(rz.entries.map((e) => e.name)).toContain('Vol 01/007.jpg');
    expect(rz.entries).toHaveLength(13);
    const before = log.length;
    const got = await rz.readMany(rz.entries.filter((e) => /00[5-7]\.jpg$/.test(e.name)));
    expect([...got.keys()].sort()).toEqual(['Vol 01/005.jpg', 'Vol 01/006.jpg', 'Vol 01/007.jpg']);
    expect(got.get('Vol 01/006.jpg')).toEqual(files['Vol 01/006.jpg']);
    expect(log.length - before).toBe(1); // neighbouring pages fetched in one ranged request
    const transferred = log
      .slice(before)
      .map((r) => r.split('-').map(Number))
      .reduce((n, [a, b]) => n + b - a + 1, 0);
    expect(transferred).toBeLessThan(zip.length / 3);
  });

  it('inflates deflated entries and decodes Japanese names', async () => {
    const text = new TextEncoder().encode('アオのハコ'.repeat(2000));
    const zip = await buildZip({ 'アオのハコ 01/page 1.txt': text }, 6);
    const rz = await new RemoteZip('u', {}, rangeServer(zip, [])).open();
    expect(rz.entries[0].name).toBe('アオのハコ 01/page 1.txt');
    expect(rz.entries[0].method).toBe(8);
    const out = await rz.read(rz.entries[0]);
    expect(out.length).toBe(text.length);
    expect(new TextDecoder().decode(out)).toBe(new TextDecoder().decode(text)); // compare bytes, not realms
  });

  it('works when the server ignores Range and sends the whole file', async () => {
    const zip = await buildZip({ 'a.jpg': page(1, 1000), 'b.jpg': page(2, 1000) });
    const plain = (async (_u: string | URL | Request, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 200, headers: { 'content-length': String(zip.length) } })
        : new Response(zip as BlobPart, { status: 200 })) as typeof fetch;
    const rz = await new RemoteZip('u', {}, plain).open();
    expect(await rz.read(rz.entries.find((e) => e.name === 'b.jpg')!)).toEqual(page(2, 1000));
  });
});

/**
 * Read individual entries of a remote ZIP/CBZ with HTTP Range requests (manga-immersion fork).
 *
 * Only the central directory (at the end of the file) and the requested entries are transferred, so a
 * reader can show the first pages of a volume after a few hundred KB instead of the whole archive.
 * Supports stored and deflated entries and ZIP64 (archives > 4 GB). The archive size comes from HEAD
 * Content-Length (Bunko exposes Content-Length but not Content-Range to scripts).
 */
export interface RemoteZipEntry {
  name: string;
  method: number; // 0 stored, 8 deflate
  compressedSize: number;
  size: number;
  offset: number; // local header offset
}

type FetchLike = typeof fetch;

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export class RemoteZip {
  size = 0;
  entries: RemoteZipEntry[] = [];

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  private async range(start: number, endInclusive: number): Promise<Uint8Array> {
    const res = await this.fetchImpl(this.url, {
      headers: { ...this.headers, Range: `bytes=${start}-${endInclusive}` },
      cache: 'no-store'
    });
    if (res.status !== 206 && res.status !== 200)
      throw new Error(`range ${start}-${endInclusive}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (res.status === 200) return buf.subarray(start, endInclusive + 1); // server ignored Range
    return buf;
  }

  async open(): Promise<this> {
    const head = await this.fetchImpl(this.url, {
      method: 'HEAD',
      headers: this.headers,
      cache: 'no-store'
    });
    if (!head.ok) throw new Error(`HEAD: HTTP ${head.status}`);
    this.size = Number(head.headers.get('content-length') ?? 0);
    if (!this.size) throw new Error('archive size unknown (no Content-Length)');

    const tailLen = Math.min(this.size, 65536 + 22);
    const tailStart = this.size - tailLen;
    const tail = await this.range(tailStart, this.size - 1);
    const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');
    let count = dv.getUint16(eocd + 10, true);
    let cdSize = dv.getUint32(eocd + 12, true);
    let cdOffset = dv.getUint32(eocd + 16, true);

    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || dv.getUint32(loc, true) !== SIG_ZIP64_LOCATOR)
        throw new Error('zip64 locator missing');
      const z64Offset = Number(dv.getBigUint64(loc + 8, true));
      const z64 =
        z64Offset >= tailStart
          ? tail.subarray(z64Offset - tailStart, z64Offset - tailStart + 56)
          : await this.range(z64Offset, z64Offset + 55);
      const zdv = new DataView(z64.buffer, z64.byteOffset, z64.byteLength);
      if (zdv.getUint32(0, true) !== SIG_ZIP64_EOCD)
        throw new Error('zip64 end of central directory missing');
      count = Number(zdv.getBigUint64(32, true));
      cdSize = Number(zdv.getBigUint64(40, true));
      cdOffset = Number(zdv.getBigUint64(48, true));
    }

    const cd =
      cdOffset >= tailStart
        ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize)
        : await this.range(cdOffset, cdOffset + cdSize - 1);
    this.entries = parseCentralDirectory(cd, count);
    return this;
  }

  /** Read several entries, merging neighbouring ones into a single ranged request where possible. */
  async readMany(
    list: RemoteZipEntry[],
    maxChunk = 8 * 1024 * 1024
  ): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    const sorted = [...list].sort((a, b) => a.offset - b.offset);
    let i = 0;
    while (i < sorted.length) {
      const group = [sorted[i]];
      let end = entryEnd(sorted[i]);
      while (i + group.length < sorted.length) {
        const next = sorted[i + group.length];
        if (next.offset - end > 65536 || entryEnd(next) - sorted[i].offset > maxChunk) break;
        group.push(next);
        end = Math.max(end, entryEnd(next));
      }
      const start = sorted[i].offset;
      const buf = await this.range(start, Math.min(this.size - 1, end + 1024));
      for (const e of group) out.set(e.name, await this.extract(e, buf, start));
      i += group.length;
    }
    return out;
  }

  async read(entry: RemoteZipEntry): Promise<Uint8Array> {
    return (await this.readMany([entry])).get(entry.name)!;
  }

  private async extract(e: RemoteZipEntry, buf: Uint8Array, bufStart: number): Promise<Uint8Array> {
    let rel = e.offset - bufStart;
    let local = buf;
    if (rel + 30 > local.length) {
      local = await this.range(e.offset, e.offset + 30 + 1024 + e.compressedSize);
      rel = 0;
    }
    const dv = new DataView(local.buffer, local.byteOffset, local.byteLength);
    if (dv.getUint32(rel, true) !== SIG_LOCAL) throw new Error(`bad local header for ${e.name}`);
    const nameLen = dv.getUint16(rel + 26, true);
    const extraLen = dv.getUint16(rel + 28, true);
    const dataStart = rel + 30 + nameLen + extraLen;
    let data: Uint8Array;
    if (dataStart + e.compressedSize <= local.length)
      data = local.subarray(dataStart, dataStart + e.compressedSize);
    else
      data = await this.range(
        e.offset + 30 + nameLen + extraLen,
        e.offset + 30 + nameLen + extraLen + e.compressedSize - 1
      );
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRaw(data);
    throw new Error(`unsupported compression method ${e.method} for ${e.name}`);
  }
}

function entryEnd(e: RemoteZipEntry): number {
  // local header (30) + name/extra (unknown, assume ≤ 1 KB) + data
  return e.offset + 30 + e.compressedSize + 1024;
}

export function parseCentralDirectory(cd: Uint8Array, count: number): RemoteZipEntry[] {
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: RemoteZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) throw new Error('corrupt central directory');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    let compressedSize = dv.getUint32(p + 20, true);
    let size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let offset = dv.getUint32(p + 42, true);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
    const name = decodeName(nameBytes, (flags & 0x0800) !== 0);
    // ZIP64 extended information extra field
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = dv.getUint16(e, true);
      const len = dv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (offset === 0xffffffff) offset = Number(dv.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    if (!name.endsWith('/')) entries.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return new TextDecoder('latin1').decode(bytes);
    }
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

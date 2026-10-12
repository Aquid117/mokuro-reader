/**
 * Map UTF-16 offsets of a block's concatenated text back onto the DOM text nodes that render it.
 *
 * A Mokuro text box renders each OCR line as one `span.ocr-line` holding a single text node. The
 * block text sent to Jiten is the concatenation of those text nodes in DOM order (no separator —
 * vertical manga text wraps mid-word across lines). Lines hidden by the layout are not in the DOM,
 * so they are automatically excluded on both sides.
 */
export interface TextSegment {
  node: Text;
  /** cumulative UTF-16 offset of this node's first character within the block text */
  start: number;
  length: number;
}

export function collectTextSegments(block: Element): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  const lines = block.querySelectorAll('.ocr-line');
  const sources: Element[] = lines.length ? Array.from(lines) : [block];
  for (const line of sources) {
    const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n as Text;
      if (t.data.length === 0) continue;
      segments.push({ node: t, start: cursor, length: t.data.length });
      cursor += t.data.length;
    }
  }
  return segments;
}

export function blockText(segments: TextSegment[]): string {
  return segments.map((s) => s.node.data).join('');
}

export interface NodeSlice {
  node: Text;
  start: number;
  end: number;
}

/** Split the half-open block range [s, e) into per-text-node slices. */
export function sliceRange(segments: TextSegment[], s: number, e: number): NodeSlice[] {
  const out: NodeSlice[] = [];
  if (e <= s) return out;
  for (const seg of segments) {
    const segEnd = seg.start + seg.length;
    if (segEnd <= s) continue;
    if (seg.start >= e) break;
    out.push({
      node: seg.node,
      start: Math.max(s, seg.start) - seg.start,
      end: Math.min(e, segEnd) - seg.start
    });
  }
  return out;
}

export function slicesToRanges(slices: NodeSlice[]): Range[] {
  return slices.map(({ node, start, end }) => {
    const range = node.ownerDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  });
}

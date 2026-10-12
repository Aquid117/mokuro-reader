/**
 * Tiny, safe Markdown subset for AI follow-up answers: escapes HTML first, then renders **bold**,
 * *italic*, `code`, "- " / "1. " lists and paragraphs. No links or raw HTML.
 */
function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(t: string): string {
  return esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const endPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const endList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (ul || ol) {
      endPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        endList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (h) {
      endPara();
      endList();
      out.push(`<p><strong>${inline(h[1])}</strong></p>`);
    } else if (line.trim() === '') {
      endPara();
      endList();
    } else {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  return out.join('');
}

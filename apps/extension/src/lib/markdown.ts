// Minimal, safe markdown for explanations: paragraphs, lists, headings,
// **bold**, *italic*, `code`. Parsed to a tiny AST and built with DOM nodes —
// never innerHTML — so model output can't inject markup. Staying in plain DOM
// also lets Yomitan scan the answer text.

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string };

export type MdBlock =
  | { type: 'paragraph'; lines: MdInline[][] }
  | { type: 'heading'; inlines: MdInline[] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const INLINE = /(\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+)`|\*([^*\s][^*\n]*?)\*|_([^_\s][^_\n]*?)_)/g;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    if (m[2] !== undefined || m[3] !== undefined) out.push({ type: 'bold', text: (m[2] ?? m[3])! });
    else if (m[4] !== undefined) out.push({ type: 'code', text: m[4] });
    else out.push({ type: 'italic', text: (m[5] ?? m[6])! });
    last = index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length) blocks.push({ type: 'paragraph', lines: paragraph.map(parseInline) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', inlines: parseInline(heading[1]!) });
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (list && /^\s+/.test(raw)) {
      // Indented continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function renderMarkdown(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(source)) {
    if (block.type === 'heading') {
      fragment.append(withInlines(document.createElement('h4'), block.inlines));
    } else if (block.type === 'paragraph') {
      const p = document.createElement('p');
      block.lines.forEach((line, i) => {
        if (i > 0) p.append(document.createElement('br'));
        withInlines(p, line);
      });
      fragment.append(p);
    } else {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) list.append(withInlines(document.createElement('li'), item));
      fragment.append(list);
    }
  }
  return fragment;
}

function withInlines<T extends HTMLElement>(parent: T, inlines: MdInline[]): T {
  for (const inline of inlines) {
    if (inline.type === 'text') {
      parent.append(inline.text);
      continue;
    }
    const el = document.createElement(
      inline.type === 'bold' ? 'strong' : inline.type === 'italic' ? 'em' : 'code',
    );
    el.textContent = inline.text;
    parent.append(el);
  }
  return parent;
}

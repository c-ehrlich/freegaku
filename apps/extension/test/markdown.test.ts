import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../src/lib/markdown';

describe('parseInline', () => {
  it('parses bold, italic and code', () => {
    expect(parseInline('**て形** is *casual* with `ちゃう`')).toEqual([
      { type: 'bold', text: 'て形' },
      { type: 'text', text: ' is ' },
      { type: 'italic', text: 'casual' },
      { type: 'text', text: ' with ' },
      { type: 'code', text: 'ちゃう' },
    ]);
  });

  it('leaves lone asterisks alone', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs, headings and lists', () => {
    const blocks = parseMarkdown('## Meaning\nLine one\nline two\n\n- a\n- b\n  continued\n1. first\n2. second');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      lines: [[{ type: 'text', text: 'Line one' }], [{ type: 'text', text: 'line two' }]],
    });
    expect(blocks[2]).toEqual({
      type: 'list',
      ordered: false,
      items: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b continued' }]],
    });
    expect(blocks[3]).toMatchObject({ type: 'list', ordered: true });
  });

  it('treats html as text', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', text: '<img src=x onerror=alert(1)>' }]] },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { parseSrv3 } from '../src/srv3';

describe('parseSrv3', () => {
  it('parses manual captions with entities, breaks, and timings', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
  <head><pen id="1" /></head>
  <body>
    <p t="1000" d="1500">Tom &amp; Jerry&#39;s &lt;show&gt;</p>
    <p t="3000" d="2000">first<br/>second<br />third</p>
    <p t="6000" d="1000"><s p="1">styled</s> text</p>
  </body>
</timedtext>`;

    expect(parseSrv3(xml)).toEqual([
      {
        start: 1000,
        end: 2500,
        text: "Tom & Jerry's <show>",
      },
      {
        start: 3000,
        end: 5000,
        text: 'first\nsecond\nthird',
      },
      {
        start: 6000,
        end: 7000,
        text: 'styled text',
      },
    ]);
  });

  it('parses ASR word timings, drops separators, and clamps overlapping cues', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
  <body>
    <p t="4000" d="3000" w="1"><s ac="248">first</s><s t="480" ac="235"> word</s><s t="960"> timed</s></p>
    <p t="6500" d="500" w="1" a="1">
</p>
    <p t="7000" d="1800" w="1"><s>next</s><s t="500"> line</s></p>
  </body>
</timedtext>`;

    expect(parseSrv3(xml)).toEqual([
      {
        start: 4000,
        end: 6500,
        text: 'first word timed',
        words: [
          { start: 4000, end: 4480, text: 'first' },
          { start: 4480, end: 4960, text: ' word' },
          { start: 4960, end: 6500, text: ' timed' },
        ],
      },
      {
        start: 7000,
        end: 8800,
        text: 'next line',
        words: [
          { start: 7000, end: 7500, text: 'next' },
          { start: 7500, end: 8800, text: ' line' },
        ],
      },
    ]);
  });

  it('preserves CJK ASR text without inserted spaces', () => {
    const xml = `<timedtext format="3"><body>
      <p t="100" d="900" w="1"><s>日</s><s t="300">本</s><s t="600">語</s></p>
    </body></timedtext>`;

    expect(parseSrv3(xml)).toEqual([
      {
        start: 100,
        end: 1000,
        text: '日本語',
        words: [
          { start: 100, end: 400, text: '日' },
          { start: 400, end: 700, text: '本' },
          { start: 700, end: 1000, text: '語' },
        ],
      },
    ]);
  });

  it('returns an empty array for empty and garbage input', () => {
    expect(parseSrv3('')).toEqual([]);
    expect(parseSrv3('not xml at all <p t="1">unterminated')).toEqual([]);
    expect(parseSrv3('<timedtext><body><p d="1000">missing start</p></body></timedtext>')).toEqual([]);
  });

  it('decodes decimal and hex numeric entities', () => {
    const xml = `<timedtext format="3"><body>
      <p t="0" d="1000">&#65; &#x41; &#x1F600;</p>
    </body></timedtext>`;

    expect(parseSrv3(xml)).toEqual([
      {
        start: 0,
        end: 1000,
        text: 'A A 😀',
      },
    ]);
  });
});

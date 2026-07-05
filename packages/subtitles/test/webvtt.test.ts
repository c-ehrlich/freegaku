import { describe, expect, it } from 'vitest';

import { parseWebVtt } from '../src/webvtt';

describe('parseWebVtt', () => {
  it('parses a basic file with a WEBVTT header and hourless and hourful timestamps', () => {
    const vtt = `\uFEFFWEBVTT Netflix

01:02.500 --> 01:04.000
first

01:01:02.500 --> 01:01:04.000
second`;

    expect(parseWebVtt(vtt)).toEqual([
      { start: 62500, end: 64000, text: 'first' },
      { start: 3662500, end: 3664000, text: 'second' },
    ]);
  });

  it('treats input without a WEBVTT header as a cue list', () => {
    const vtt = `00:00.000 --> 00:01.000
headerless cue`;

    expect(parseWebVtt(vtt)).toEqual([{ start: 0, end: 1000, text: 'headerless cue' }]);
  });

  it('discards cue settings after timestamps', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:01.000 position:50% line:85% align:center
settings are ignored`;

    expect(parseWebVtt(vtt)).toEqual([{ start: 0, end: 1000, text: 'settings are ignored' }]);
  });

  it('accepts identifier lines before timing lines', () => {
    const vtt = `WEBVTT

cue-1
00:00.250 --> 00:01.250
identified`;

    expect(parseWebVtt(vtt)).toEqual([{ start: 250, end: 1250, text: 'identified' }]);
  });

  it('strips tags while preserving inner text and removes ruby readings', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:02.000
<v Bob><i>Hello <c.japanese><ruby>漢字<rt>かんじ</rt></ruby></c.japanese></i></v>

00:02.000 --> 00:03.000
<ruby>今日<rt.reading>きょう</rt></ruby><00:00:02.500>です`;

    expect(parseWebVtt(vtt)).toEqual([
      { start: 0, end: 2000, text: 'Hello 漢字' },
      { start: 2000, end: 3000, text: '今日です' },
    ]);
  });

  it('decodes entities, removes directional marks, and converts nbsp to regular spaces', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:01.000
Tom&nbsp;&amp;&nbsp;Jerry &lt;show&gt; &quot;ok&quot; &#39;yes&#39; &#x41;&#65; &lrm;\u200f&amp;lrm;`;

    expect(parseWebVtt(vtt)).toEqual([
      { start: 0, end: 1000, text: `Tom & Jerry <show> "ok" 'yes' AA` },
    ]);
  });

  it('skips NOTE and STYLE blocks', () => {
    const vtt = `WEBVTT

NOTE this should be skipped
00:00.000 --> 00:10.000
not a cue

STYLE
::cue { color: white; }

00:01.000 --> 00:02.000
real cue`;

    expect(parseWebVtt(vtt)).toEqual([{ start: 1000, end: 2000, text: 'real cue' }]);
  });

  it('normalizes CRLF input', () => {
    const vtt = 'WEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\nfirst\r\nsecond';

    expect(parseWebVtt(vtt)).toEqual([{ start: 0, end: 1000, text: 'first\nsecond' }]);
  });

  it('preserves overlapping cues as-is and sorts by start', () => {
    const vtt = `WEBVTT

00:02.000 --> 00:05.000
dialogue

00:01.000 --> 00:04.000
sign

00:01.000 --> 00:03.000
same start`;

    expect(parseWebVtt(vtt)).toEqual([
      { start: 1000, end: 4000, text: 'sign' },
      { start: 1000, end: 3000, text: 'same start' },
      { start: 2000, end: 5000, text: 'dialogue' },
    ]);
  });

  it('joins multi-line cue text with newlines after trimming and dropping empty lines', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:01.000
  first line
  <i></i>
  second line  `;

    expect(parseWebVtt(vtt)).toEqual([
      { start: 0, end: 1000, text: 'first line\nsecond line' },
    ]);
  });

  it('returns an empty array for empty and garbage input', () => {
    expect(parseWebVtt('')).toEqual([]);
    expect(parseWebVtt('not vtt at all')).toEqual([]);
    expect(parseWebVtt('00:02.000 --> 00:01.000\nbackwards')).toEqual([]);
    expect(parseWebVtt('00:00.000 --> nope\nbad timing')).toEqual([]);
  });
});

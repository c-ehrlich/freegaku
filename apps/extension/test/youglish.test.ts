import { describe, expect, it } from 'vitest';
import { normalizeYouglishClip, normalizeYouglishTranscript } from '../src/lib/youglish';

describe('normalizeYouglishClip', () => {
  it('normalizes a selected YouGlish result', () => {
    expect(
      normalizeYouglishClip({
        display: ' 建築目的を  [[[家族]]]と一緒に ',
        vid: 'oKUCpXOUK10',
        start: '576',
        end: '582',
      }),
    ).toEqual({
      text: '建築目的を 家族と一緒に',
      videoId: 'oKUCpXOUK10',
      startMs: 576_000,
      endMs: 582_000,
    });
  });

  it('uses the player video ID for live captions with internal numeric IDs', () => {
    expect(
      normalizeYouglishClip(
        { display: '現在の字幕', vid: 40, start: 352.25, end: 357.1 },
        'A2ld4Ffz7IU',
      ),
    ).toEqual({
      text: '現在の字幕',
      videoId: 'A2ld4Ffz7IU',
      startMs: 352_250,
      endMs: 357_100,
    });
  });

  it.each([
    null,
    {},
    { display: '', vid: 'oKUCpXOUK10', start: 1, end: 2 },
    { display: 'line', vid: 'bad', start: 1, end: 2 },
    { display: 'line', vid: 'oKUCpXOUK10', start: -1, end: 2 },
    { display: 'line', vid: 'oKUCpXOUK10', start: 2, end: 2 },
    { display: 'line', vid: 'oKUCpXOUK10', start: 1, end: 32 },
  ])('rejects malformed clip data %#', (value) => {
    expect(normalizeYouglishClip(value)).toBeNull();
  });
});

describe('normalizeYouglishTranscript', () => {
  it('normalizes, sorts, and deduplicates a full YouGlish caption track', () => {
    expect(
      normalizeYouglishTranscript(
        {
          results: [
            { display: '次', start: 3 },
            { display: '前', start: 1 },
            { display: '前', start: 1 },
          ],
        },
        'oKUCpXOUK10',
      ),
    ).toEqual([
      { text: '前', videoId: 'oKUCpXOUK10', startMs: 1_000, endMs: 3_000 },
      { text: '次', videoId: 'oKUCpXOUK10', startMs: 3_000, endMs: 8_000 },
    ]);
  });
});

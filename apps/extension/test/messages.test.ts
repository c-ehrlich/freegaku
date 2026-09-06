import { describe, expect, it } from 'vitest';
import {
  isCaptureWindow,
  isM2EmbedRequest,
  isYouglishResultPayload,
} from '../src/lib/messages';

describe('embedded-player request validation', () => {
  it('accepts state, playback, seek, and capture requests', () => {
    expect(isM2EmbedRequest({ type: 'm2-embed-state' })).toBe(true);
    expect(isM2EmbedRequest({ type: 'm2-embed-control', action: 'play' })).toBe(true);
    expect(isM2EmbedRequest({ type: 'm2-embed-control', action: 'pause' })).toBe(true);
    expect(isM2EmbedRequest({ type: 'm2-embed-control', action: 'seek', ms: 12_500 })).toBe(true);
    expect(
      isM2EmbedRequest({
        type: 'm2-embed-transcript',
        videoId: 'oKUCpXOUK10',
        languageCode: 'ja',
      }),
    ).toBe(true);
    expect(
      isM2EmbedRequest({
        type: 'm2-embed-capture',
        capture: { startMs: 10_000, endMs: 12_000, imageMs: 11_000 },
        options: { padStartMs: 500, padEndMs: 500, imageMaxWidth: 1280, jpegQuality: 0.9 },
      }),
    ).toBe(true);
  });

  it.each([
    { type: 'm2-embed-control', action: 'seek' },
    { type: 'm2-embed-control', action: 'seek', ms: -1 },
    { type: 'm2-embed-control', action: 'play', ms: 1 },
    { type: 'm2-embed-transcript', languageCode: 'ja' },
    { type: 'm2-embed-transcript', videoId: 'bad', languageCode: 'ja' },
    { type: 'm2-embed-transcript', videoId: 'oKUCpXOUK10', languageCode: '../ja' },
    {
      type: 'm2-embed-capture',
      capture: { startMs: 0, endMs: 31_000, imageMs: 1_000 },
    },
    {
      type: 'm2-embed-capture',
      capture: { startMs: 0, endMs: 1_000, imageMs: 500 },
      options: { jpegQuality: 2 },
    },
  ])('rejects malformed requests %#', (request) => {
    expect(isM2EmbedRequest(request)).toBe(false);
  });
});

describe('capture window validation', () => {
  it('accepts a finite ordered range and rejects an out-of-range image', () => {
    expect(isCaptureWindow({ startMs: 1, endMs: 2, imageMs: 1.5 })).toBe(true);
    expect(isCaptureWindow({ startMs: 1, endMs: 2, imageMs: 3 })).toBe(false);
  });
});

describe('YouGlish result validation', () => {
  const result = {
    index: 1,
    total: 100,
    query: '家族',
    text: '家族と一緒に',
    videoId: 'oKUCpXOUK10',
    startMs: 576_000,
    endMs: 582_000,
    title: 'A YouTube video',
    cues: [
      { text: '前の字幕', startMs: 573_000, endMs: 576_000 },
      { text: '家族と一緒に', startMs: 576_000, endMs: 582_000 },
      { text: '次の字幕', startMs: 582_000, endMs: 585_000 },
    ],
  };

  it('accepts normalized results', () => {
    expect(isYouglishResultPayload(result)).toBe(true);
  });

  it('rejects invalid IDs, indexes, and clip ranges', () => {
    expect(isYouglishResultPayload({ ...result, videoId: 'bad' })).toBe(false);
    expect(isYouglishResultPayload({ ...result, index: 0 })).toBe(false);
    expect(isYouglishResultPayload({ ...result, endMs: result.startMs })).toBe(false);
    expect(isYouglishResultPayload({ ...result, cues: [] })).toBe(false);
  });
});

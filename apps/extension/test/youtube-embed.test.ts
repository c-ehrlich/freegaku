import { describe, expect, it } from 'vitest';
import { preferredEmbedVideoId } from '../src/lib/youtube-embed';

describe('preferredEmbedVideoId', () => {
  it('prefers MAIN-world discovery after loadVideoById leaves stale embed DOM', () => {
    expect(preferredEmbedVideoId('JysrbxSFsAY', 'oKUCpXOUK10')).toBe('JysrbxSFsAY');
  });

  it('uses the DOM/embed ID while discovery is still starting', () => {
    expect(preferredEmbedVideoId(null, 'oKUCpXOUK10')).toBe('oKUCpXOUK10');
  });
});

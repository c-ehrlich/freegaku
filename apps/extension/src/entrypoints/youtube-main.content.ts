import { M2_SOURCE, isM2Message } from '../lib/messages';
import type { TrackInfo, VideoTracksPayload } from '../lib/messages';

// MAIN-world script: runs in the page context so it can read YouTube's live
// player state. Caption URLs taken from the player already carry the PO token
// (`pot=`) that plain ytInitialPlayerResponse URLs increasingly lack — without
// it the timedtext endpoint returns empty 200s.

const PLAYER_POLL_INTERVAL_MS = 250;
const PLAYER_POLL_TIMEOUT_MS = 10_000;
const NAV_POLL_INTERVAL_MS = 500;

interface YtPlayerElement extends HTMLElement {
  getAudioTrack?: () => { captionTracks?: RawPlayerTrack[] } | undefined;
  getVideoData?: () => { video_id?: string; title?: string; author?: string } | undefined;
}

interface RawPlayerTrack {
  url?: string;
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  displayName?: string;
  languageName?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    let lastVideoId: string | null | undefined; // undefined = no discovery yet
    let lastPayload: VideoTracksPayload | null = null;
    let seq = 0;

    function post(payload: VideoTracksPayload): void {
      lastPayload = payload;
      window.postMessage({ source: M2_SOURCE, type: 'tracks', payload }, '*');
    }

    function videoIdFromUrl(): string | null {
      const url = new URL(location.href);
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const short = /^\/(?:shorts|embed)\/([\w-]{11})/.exec(url.pathname);
      return short?.[1] ?? null;
    }

    function trackLabel(t: RawPlayerTrack): string {
      return (
        t.displayName ??
        t.name?.simpleText ??
        t.name?.runs?.map((r) => r.text ?? '').join('') ??
        t.languageName ??
        t.languageCode ??
        'unknown'
      );
    }

    function normalizeTracks(raw: RawPlayerTrack[]): TrackInfo[] {
      const tracks: TrackInfo[] = [];
      for (const t of raw) {
        const url = t.url ?? t.baseUrl;
        if (!url) continue;
        tracks.push({
          url,
          languageCode: t.languageCode ?? '',
          kind: t.kind === 'asr' ? 'asr' : '',
          label: trackLabel(t),
        });
      }
      return tracks;
    }

    /** Tier 1: poll the live player until its caption track URLs carry pot=. */
    async function playerTracks(
      videoId: string,
      cancelled: () => boolean,
    ): Promise<VideoTracksPayload | null> {
      const deadline = performance.now() + PLAYER_POLL_TIMEOUT_MS;
      let candidate: VideoTracksPayload | null = null;
      while (performance.now() < deadline) {
        if (cancelled()) return null;
        const player = document.querySelector<YtPlayerElement>('#movie_player');
        const data = player?.getVideoData?.();
        if (player && data?.video_id === videoId) {
          const raw = player.getAudioTrack?.()?.captionTracks;
          if (Array.isArray(raw) && raw.length > 0) {
            const tracks = normalizeTracks(raw);
            if (tracks.length > 0) {
              candidate = {
                videoId,
                title: data.title ?? '',
                author: data.author ?? '',
                source: 'player',
                tracks,
              };
              if (tracks.some((t) => t.url.includes('pot='))) return candidate;
            }
          }
        }
        await sleep(PLAYER_POLL_INTERVAL_MS);
      }
      // Timed out waiting for pot= — return whatever the player had; the fetch
      // may still succeed on videos where enforcement is off.
      return candidate;
    }

    /** Tier 2: InnerTube with the ANDROID client, whose URLs need no POT (for now). */
    async function innertubeTracks(videoId: string): Promise<VideoTracksPayload | null> {
      const ytcfg = (window as unknown as { ytcfg?: { get?: (k: string) => unknown } }).ytcfg;
      const key = ytcfg?.get?.('INNERTUBE_API_KEY');
      const url = `/youtubei/v1/player${typeof key === 'string' ? `?key=${key}` : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
              androidSdkVersion: 30,
              hl: 'en',
            },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: RawPlayerTrack[] } };
        videoDetails?: { title?: string; author?: string };
      };
      const raw = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!Array.isArray(raw) || raw.length === 0) return null;
      const tracks = normalizeTracks(raw);
      if (tracks.length === 0) return null;
      return {
        videoId,
        title: data.videoDetails?.title ?? '',
        author: data.videoDetails?.author ?? '',
        source: 'innertube',
        tracks,
      };
    }

    async function discover(videoId: string | null): Promise<void> {
      const mySeq = ++seq;
      lastVideoId = videoId;
      if (!videoId) {
        post({ videoId: null, title: '', author: '', source: 'none', tracks: [] });
        return;
      }
      const fromPlayer = await playerTracks(videoId, () => mySeq !== seq);
      if (mySeq !== seq) return;
      if (fromPlayer) {
        post(fromPlayer);
        return;
      }
      const fromInnertube = await innertubeTracks(videoId).catch(() => null);
      if (mySeq !== seq) return;
      post(fromInnertube ?? { videoId, title: '', author: '', source: 'none', tracks: [] });
    }

    function checkNavigation(): void {
      const id = videoIdFromUrl();
      if (id !== lastVideoId) void discover(id);
    }

    // Belt and braces: yt-navigate-finish is unofficial, so poll the URL too.
    setInterval(checkNavigation, NAV_POLL_INTERVAL_MS);
    document.addEventListener('yt-navigate-finish', () => setTimeout(checkNavigation, 0));

    // The isolated-world script announces itself; replay or (re)discover.
    window.addEventListener('message', (e) => {
      if (e.source !== window || !isM2Message(e.data)) return;
      if (e.data.type !== 'refresh') return;
      const id = videoIdFromUrl();
      if (lastPayload && lastPayload.videoId === id && lastPayload.tracks.length > 0) {
        post(lastPayload);
      } else {
        void discover(id);
      }
    });

    checkNavigation();
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

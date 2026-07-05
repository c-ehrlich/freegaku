import { M2_SOURCE, isM2Message } from '../lib/messages';
import type { TrackInfo, VideoTracksPayload } from '../lib/messages';

// MAIN-world script for netflix.com, document_start. Two jobs:
//
// 1. Manifest interception (the subadub technique, LR-hardened): hook
//    JSON.stringify to add the WebVTT profile + showAllSubDubTracks to the
//    MSL manifest request (all tracks hydrate with download URLs up front),
//    and JSON.parse to harvest the per-track WebVTT URLs from the response.
//    Field names renamed June 2026 (timedtexttracks→textTracks etc.) —
//    accept both generations.
// 2. Player bridge: expose seek/play/pause via Netflix's unofficial player
//    API. Setting video.currentTime corrupts the cadmium player; player
//    .seek(ms) is the only safe seek.

const WEBVTT_PROFILE = 'webvtt-lssdh-ios8';
const POLL_INTERVAL_MS = 500;

interface NetflixPlayer {
  seek: (ms: number) => void;
  play: () => void;
  pause: () => void;
  getMovieId: () => number;
}

export default defineContentScript({
  matches: ['*://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    console.debug('[m2:nf] main-world script loaded');
    const manifestTracks = new Map<string, TrackInfo[]>();
    let lastPostedKey = '';

    // Force-enable Netflix's A/B-gated frame-precise seeking (otherwise
    // player.seek() lands on keyframes, several hundred ms off). Same
    // Function.prototype.apply proxy that asbplayer and Language Reactor ship.
    const origApply = Function.prototype.apply;
    Function.prototype.apply = new Proxy(origApply, {
      apply(target, thisArg, argList: unknown[]) {
        try {
          const callArgs = argList?.[1];
          if (Array.isArray(callArgs) && typeof callArgs[0] === 'string') {
            const key = callArgs[0].toLowerCase();
            if (key === 'preciseseeking' || key === 'preciseseekingontwocoredevice') return true;
          }
        } catch {
          // fall through to the real apply
        }
        return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, argList as [unknown, unknown[]]);
      },
    }) as typeof Function.prototype.apply;

    // --- manifest request hook -------------------------------------------
    const origStringify = JSON.stringify.bind(JSON);
    JSON.stringify = function (value: unknown, ...rest: unknown[]): string {
      try {
        mutateManifestRequest(value);
      } catch {
        // never break Netflix
      }
      return (origStringify as (...a: unknown[]) => string)(value, ...rest);
    } as typeof JSON.stringify;

    function mutateManifestRequest(value: unknown): void {
      if (typeof value !== 'object' || value === null) return;
      const obj = value as Record<string, unknown>;
      if (obj.supportsPartialHydration !== undefined) {
        // LR's trick: hydrate download URLs for ALL text tracks up front.
        obj.showAllSubDubTracks = true;
      }
      const profiles = findProfilesArray(value, 0);
      if (profiles && !profiles.includes(WEBVTT_PROFILE)) profiles.unshift(WEBVTT_PROFILE);
    }

    function findProfilesArray(node: unknown, depth: number): string[] | null {
      if (depth > 8 || typeof node !== 'object' || node === null) return null;
      const obj = node as Record<string, unknown>;
      const p = obj.profiles;
      if (Array.isArray(p) && p.every((x) => typeof x === 'string')) return p as string[];
      for (const value of Object.values(obj)) {
        const found = findProfilesArray(value, depth + 1);
        if (found) return found;
      }
      return null;
    }

    // --- manifest response hook ------------------------------------------
    const origParse = JSON.parse.bind(JSON);
    JSON.parse = function (text: string, ...rest: unknown[]): unknown {
      const value = (origParse as (...a: unknown[]) => unknown)(text, ...rest);
      try {
        harvestManifest(value);
      } catch {
        // never break Netflix
      }
      return value;
    } as typeof JSON.parse;

    interface RawTrack {
      isForcedNarrative?: boolean;
      isNoneTrack?: boolean;
      language?: string;
      languageDescription?: string;
      rawTrackType?: string;
      downloadables?: Record<string, RawDownloadable>;
      ttDownloadables?: Record<string, RawDownloadable>;
    }
    interface RawDownloadable {
      urls?: Array<{ url?: string } | string>;
      downloadUrls?: Record<string, string>;
    }

    function harvestManifest(value: unknown): void {
      const result = (value as { result?: Record<string, unknown> } | null)?.result;
      if (!result) return;
      const rawTracks = (result.textTracks ?? result.timedtexttracks) as RawTrack[] | undefined;
      const movieId = result.movieId;
      if (!movieId || !Array.isArray(rawTracks)) return;
      const tracks: TrackInfo[] = [];
      for (const t of rawTracks) {
        if (!t || t.isForcedNarrative || t.isNoneTrack) continue;
        const vtt = (t.downloadables ?? t.ttDownloadables)?.[WEBVTT_PROFILE];
        if (!vtt) continue;
        let url: string | undefined;
        const urls = vtt.urls;
        if (Array.isArray(urls)) {
          const first = urls[0];
          url = typeof first === 'string' ? first : first?.url;
        } else if (vtt.downloadUrls) {
          url = Object.values(vtt.downloadUrls)[0];
        }
        if (!url) continue;
        const cc = (t.rawTrackType ?? '').toLowerCase() === 'closedcaptions';
        tracks.push({
          url,
          languageCode: t.language ?? '',
          kind: '',
          label: `${t.languageDescription ?? t.language ?? '?'}${cc ? ' (CC)' : ''}`,
        });
      }
      if (tracks.length > 0) {
        manifestTracks.set(String(movieId), tracks);
        console.debug('[m2:nf] harvested manifest', movieId, tracks.length, 'tracks');
        postState();
      }
    }

    // --- player bridge -----------------------------------------------------
    function getPlayer(): NetflixPlayer | null {
      try {
        const vp = (
          window as unknown as {
            netflix: {
              appContext: {
                state: {
                  playerApp: {
                    getAPI: () => {
                      videoPlayer: {
                        getAllPlayerSessionIds: () => string[];
                        getVideoPlayerBySessionId: (id: string) => NetflixPlayer;
                      };
                    };
                  };
                };
              };
            };
          }
        ).netflix.appContext.state.playerApp.getAPI().videoPlayer;
        const ids = vp.getAllPlayerSessionIds().filter((id) => id.startsWith('watch'));
        const id = ids[ids.length - 1];
        return id ? vp.getVideoPlayerBySessionId(id) : null;
      } catch {
        return null;
      }
    }

    function getMetadata(movieId: string): { title: string; author: string } {
      try {
        const api = (
          window as unknown as {
            netflix: {
              appContext: {
                state: {
                  playerApp: {
                    getAPI: () => {
                      getVideoMetadataByVideoId?: (id: string) => {
                        getCurrentVideo?: () => {
                          getTitle?: () => string;
                          isEpisodic?: () => boolean;
                          getSeason?: () => { _season?: { seq?: number } };
                          getEpisodeNumber?: () => number;
                          getEpisodeTitle?: () => string;
                        };
                      };
                    };
                  };
                };
              };
            };
          }
        ).netflix.appContext.state.playerApp.getAPI();
        const video = api.getVideoMetadataByVideoId?.(movieId)?.getCurrentVideo?.();
        if (!video) return { title: '', author: 'Netflix' };
        const title = video.getTitle?.() ?? '';
        if (video.isEpisodic?.()) {
          const season = video.getSeason?.()?._season?.seq;
          const ep = video.getEpisodeNumber?.();
          const epTitle = video.getEpisodeTitle?.() ?? '';
          const se = season !== undefined && ep !== undefined ? ` S${season}E${ep}` : '';
          return { title: `${title}${se}${epTitle ? ` — ${epTitle}` : ''}`, author: 'Netflix' };
        }
        return { title, author: 'Netflix' };
      } catch {
        return { title: '', author: 'Netflix' };
      }
    }

    // --- current-video tracking -------------------------------------------
    function currentMovieId(): string | null {
      if (!/^\/[^/]*\/?watch\//.test(location.pathname) && !location.pathname.startsWith('/watch')) {
        return null;
      }
      // data-videoid is what subadub/easysubs trust; URL can lag or be a trailer.
      const fromDom = document.querySelector<HTMLElement>('*[data-videoid]')?.dataset.videoid;
      if (fromDom) return fromDom;
      const fromPlayer = getPlayer()?.getMovieId();
      if (fromPlayer) return String(fromPlayer);
      const fromUrl = /\/watch\/(\d+)/.exec(location.pathname)?.[1];
      return fromUrl ?? null;
    }

    function postState(): void {
      const movieId = currentMovieId();
      const tracks = movieId ? (manifestTracks.get(movieId) ?? []) : [];
      const meta = movieId ? getMetadata(movieId) : { title: '', author: '' };
      // Title participates in the key: metadata often lags the first manifest,
      // so re-post once it becomes available.
      const key = `${movieId ?? 'null'}:${tracks.length}:${meta.title}`;
      if (key === lastPostedKey) return;
      lastPostedKey = key;
      const payload: VideoTracksPayload = {
        videoId: movieId,
        title: meta.title,
        author: meta.author,
        source: 'netflix',
        tracks,
      };
      console.debug('[m2:nf] posting state', movieId, tracks.length, 'tracks');
      window.postMessage({ source: M2_SOURCE, type: 'tracks', payload }, '*');
    }

    setInterval(postState, POLL_INTERVAL_MS);

    window.addEventListener('message', (e) => {
      if (e.source !== window || !isM2Message(e.data)) return;
      if (e.data.type === 'refresh') {
        lastPostedKey = '';
        postState();
      } else if (e.data.type === 'control') {
        const player = getPlayer();
        if (!player) return;
        if (e.data.action === 'seek' && typeof e.data.ms === 'number') player.seek(e.data.ms);
        else if (e.data.action === 'play') player.play();
        else if (e.data.action === 'pause') player.pause();
      }
    });
  },
});

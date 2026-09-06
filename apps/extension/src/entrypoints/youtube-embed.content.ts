import { parseSrv3 } from '@migaku2/subtitles';
import type { SubtitleCue } from '@migaku2/subtitles';
import { blobToBase64 } from '../lib/blob';
import { captureSpan } from '../lib/capture';
import { M2_SOURCE, isM2EmbedRequest, isM2Message } from '../lib/messages';
import type {
  M2EmbedCaptureRequest,
  M2EmbedCaptureResponse,
  M2EmbedRequest,
  M2EmbedResponse,
  M2EmbedState,
  TrackInfo,
  VideoTracksPayload,
} from '../lib/messages';
import { webmOpusToMp3 } from '../lib/mp3';
import { preferredEmbedVideoId } from '../lib/youtube-embed';

const VIDEO_WAIT_MS = 10_000;
const TRACK_WAIT_MS = 15_000;

export default defineContentScript({
  matches: ['https://www.youtube.com/embed/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    let tracksPayload: VideoTracksPayload | null = null;
    let tracksVersion = 0;
    const transcriptCache = new Map<string, SubtitleCue[]>();
    const resolvedVideoId = (): string | null =>
      preferredEmbedVideoId(tracksPayload?.videoId, currentVideoId());

    window.addEventListener('message', (event) => {
      if (event.source !== window || !isM2Message(event.data)) return;
      if (event.data.type === 'tracks') {
        tracksPayload = event.data.payload;
        tracksVersion++;
      }
    });

    const loadTranscript = async (
      expectedVideoId: string,
      languageCode?: string,
    ): Promise<M2EmbedResponse> => {
      await waitForVideo();
      const videoId = expectedVideoId;
      const cacheKey = `${videoId}:${languageCode ?? 'ja'}`;
      let payload = await waitForTracks(
        videoId,
        () => tracksPayload,
        () => tracksVersion,
      );
      const cached = transcriptCache.get(cacheKey);
      if (cached) return transcriptResponse(videoId, cached);
      let parsed = await fetchPreferredTrack(payload, languageCode);
      if (parsed.length === 0 && payload.source === 'player') {
        const beforeFallback = tracksVersion;
        window.postMessage({ source: M2_SOURCE, type: 'fallback', videoId }, '*');
        payload = await waitForTracks(
          videoId,
          () => tracksPayload,
          () => tracksVersion,
          beforeFallback,
          'innertube',
        );
        parsed = await fetchPreferredTrack(payload, languageCode);
      }
      if (parsed.length === 0) throw new Error('YouTube returned an empty subtitle track.');
      transcriptCache.set(cacheKey, parsed);
      return transcriptResponse(videoId, parsed);
    };

    browser.runtime.onMessage.addListener(
      (
        message: unknown,
        _sender,
        sendResponse: (response: M2EmbedResponse) => void,
      ) => {
        if (!isM2EmbedRequest(message)) return undefined;
        void dispatch(message, loadTranscript, resolvedVideoId)
          .then(sendResponse)
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;
      },
    );
    window.postMessage({ source: M2_SOURCE, type: 'refresh' }, '*');
  },
});

async function dispatch(
  message: M2EmbedRequest,
  loadTranscript: (videoId: string, languageCode?: string) => Promise<M2EmbedResponse>,
  resolvedVideoId: () => string | null,
): Promise<M2EmbedResponse> {
  if (message.type === 'm2-embed-transcript') {
    return await loadTranscript(message.videoId, message.languageCode);
  }
  const video = await waitForVideo();
  if (message.type === 'm2-embed-capture') {
    return await capture(video, message, resolvedVideoId());
  }
  if (message.type === 'm2-embed-control') {
    if (message.action === 'pause') video.pause();
    else if (message.action === 'play') await video.play();
    else video.currentTime = message.ms! / 1000;
  }
  return { ok: true, state: videoState(video, resolvedVideoId()) };
}

async function waitForTracks(
  videoId: string,
  current: () => VideoTracksPayload | null,
  version: () => number,
  afterVersion = -1,
  requiredSource?: VideoTracksPayload['source'],
): Promise<VideoTracksPayload> {
  window.postMessage({ source: M2_SOURCE, type: 'refresh' }, '*');
  const deadline = performance.now() + TRACK_WAIT_MS;
  while (performance.now() < deadline) {
    const payload = current();
    if (
      version() > afterVersion &&
      payload?.videoId === videoId &&
      (!requiredSource || payload.source === requiredSource) &&
      (payload.tracks.length > 0 || payload.source === 'none')
    ) {
      if (payload.tracks.length === 0) throw new Error('YouTube has no subtitle tracks.');
      return payload;
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for YouTube subtitle tracks.');
}

async function fetchPreferredTrack(
  payload: VideoTracksPayload,
  languageCode = 'ja',
): Promise<SubtitleCue[]> {
  const track = payload.tracks[pickPreferredTrack(payload.tracks, languageCode)];
  if (!track) return [];
  const url = new URL(track.url, location.origin);
  url.searchParams.set('fmt', 'srv3');
  if (payload.source === 'player' && payload.clientName) {
    url.searchParams.set('c', payload.clientName);
    if (payload.clientVersion) url.searchParams.set('cver', payload.clientVersion);
  }
  const response = await fetch(url.toString());
  const xml = await response.text();
  if (!response.ok || xml.length === 0) return [];
  return parseSrv3(xml);
}

function pickPreferredTrack(tracks: TrackInfo[], languageCode: string): number {
  const score = (track: TrackInfo): number => {
    const preferred =
      track.languageCode === languageCode || track.languageCode.startsWith(`${languageCode}-`);
    if (preferred && track.kind !== 'asr') return 0;
    if (preferred) return 1;
    if (track.kind !== 'asr') return 2;
    return 3;
  };
  let best = -1;
  for (let index = 0; index < tracks.length; index++) {
    if (best === -1 || score(tracks[index]!) < score(tracks[best]!)) best = index;
  }
  return best;
}

function transcriptResponse(videoId: string, cues: SubtitleCue[]): M2EmbedResponse {
  return {
    ok: true,
    videoId,
    cues: cues.map((cue) => ({ text: cue.text, startMs: cue.start, endMs: cue.end })),
  };
}

async function capture(
  video: HTMLVideoElement,
  message: M2EmbedCaptureRequest,
  videoId: string | null,
): Promise<M2EmbedCaptureResponse> {
  const { startMs, endMs, imageMs } = message.capture;
  const { audioWebm, imageJpeg } = await captureSpan(video, startMs, endMs, {
    padStartMs: message.options?.padStartMs ?? 0,
    padEndMs: message.options?.padEndMs ?? 0,
    imageTimeMs: imageMs,
    imageMaxWidth: message.options?.imageMaxWidth,
    jpegQuality: message.options?.jpegQuality,
  });
  const audioMp3 = await webmOpusToMp3(audioWebm);
  return {
    ok: true,
    audioBase64: await blobToBase64(audioMp3),
    imageBase64: imageJpeg ? await blobToBase64(imageJpeg) : null,
    videoId,
  };
}

function videoState(video: HTMLVideoElement, videoId: string | null): M2EmbedState {
  return {
    currentTimeMs: video.currentTime * 1000,
    paused: video.paused,
    videoId,
  };
}

function currentVideoId(): string | null {
  const href = document.querySelector<HTMLAnchorElement>('a.ytp-title-link[href]')?.href;
  if (href) {
    try {
      const id = new URL(href).searchParams.get('v');
      if (id && /^[\w-]{11}$/.test(id)) return id;
    } catch {
      // Fall back to the original embed URL.
    }
  }
  return /^\/embed\/([\w-]{11})/.exec(location.pathname)?.[1] ?? null;
}

function waitForVideo(): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + VIDEO_WAIT_MS;
    const poll = (): void => {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (video?.readyState) {
        resolve(video);
      } else if (performance.now() >= deadline) {
        reject(new Error('The embedded YouTube player did not expose a ready video element.'));
      } else {
        window.setTimeout(poll, 100);
      }
    };
    poll();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

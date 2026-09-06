import { M2_SOURCE, isM2Message } from '../lib/messages';
import type { YouglishResultPayload } from '../lib/messages';
import { normalizeYouglishClip, normalizeYouglishTranscript } from '../lib/youglish';
import type { YouglishClip } from '../lib/youglish';

const MATCHES = ['https://youglish.com/*', 'https://www.youglish.com/*'];
const SYNC_INTERVAL_MS = 200;

interface YouglishApi {
  EntryMng?: {
    getCurrentInd?: () => number;
    getCurrentTrack?: () => unknown;
    getTotal?: () => number;
  };
  PlayerAPI?: {
    getVideo?: () => string;
    seek?: (seconds: number) => void;
    play?: () => void;
    pause?: () => void;
  };
  CaptionMng?: {
    getCaption?: () => unknown;
    fetchAllCaptions?: (videoId: string, callback: (value: unknown) => void) => void;
  };
}

export default defineContentScript({
  matches: MATCHES,
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    let lastPostedKey = '';
    const transcriptByVideo = new Map<string, YouglishClip[]>();
    const transcriptAttempted = new Set<string>();

    function requestTranscript(api: YouglishApi | undefined, videoId: string): void {
      if (transcriptByVideo.has(videoId) || transcriptAttempted.has(videoId)) return;
      const fetchAll = api?.CaptionMng?.fetchAllCaptions;
      if (!fetchAll) return;
      transcriptAttempted.add(videoId);
      try {
        fetchAll(videoId, (value) => {
          const transcript = normalizeYouglishTranscript(value, videoId);
          if (transcript.length > 0) transcriptByVideo.set(videoId, transcript);
          lastPostedKey = '';
          postState();
        });
      } catch {}
    }

    function postState(): void {
      const api = (window as unknown as { Y?: YouglishApi }).Y;
      const index = safeNonNegativeInteger(api?.EntryMng?.getCurrentInd?.(), -1) + 1;
      const total = safeNonNegativeInteger(
        api?.EntryMng?.getTotal?.(),
        numberText('#ttl_total'),
      );
      const query = text('#ttl_q');
      const videoId = api?.PlayerAPI?.getVideo?.();
      const liveCaption = normalizeYouglishClip(api?.CaptionMng?.getCaption?.(), videoId);
      const selectedTrack = normalizeYouglishClip(api?.EntryMng?.getCurrentTrack?.(), videoId);
      const clip = liveCaption ?? selectedTrack;
      if (!clip || !query || total < index) return;
      const transcript = transcriptByVideo.get(clip.videoId) ?? [clip];

      const iframeTitle = document.querySelector<HTMLIFrameElement>('iframe#player')?.title.trim() ?? '';
      const payload: YouglishResultPayload = {
        index,
        total,
        query,
        text: clip.text,
        videoId: clip.videoId,
        startMs: clip.startMs,
        endMs: clip.endMs,
        title: iframeTitle && iframeTitle !== 'YouTube video player' ? iframeTitle : `YouGlish: ${query}`,
        cues: transcript.map((cue) => ({
          text: cue.text,
          startMs: cue.startMs,
          endMs: cue.endMs,
        })),
      };
      const key = [
        payload.index,
        payload.videoId,
        payload.startMs,
        payload.endMs,
        payload.text,
        payload.title,
        payload.cues.length,
        payload.cues[0]?.startMs,
        payload.cues.at(-1)?.endMs,
      ].join(':');
      if (key === lastPostedKey) return;
      lastPostedKey = key;
      window.postMessage({ source: M2_SOURCE, type: 'youglish-result', payload }, '*');
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window || !isM2Message(event.data)) return;
      if (event.data.type === 'refresh') {
        lastPostedKey = '';
        postState();
      } else if (event.data.type === 'youglish-transcript-fallback') {
        const api = (window as unknown as { Y?: YouglishApi }).Y;
        const videoId = api?.PlayerAPI?.getVideo?.();
        if (videoId === event.data.videoId) requestTranscript(api, videoId);
      } else if (event.data.type === 'control') {
        const player = (window as unknown as { Y?: YouglishApi }).Y?.PlayerAPI;
        if (event.data.action === 'seek') player?.seek?.((event.data.ms ?? 0) / 1000);
        else if (event.data.action === 'play') player?.play?.();
        else player?.pause?.();
      }
    });

    setInterval(postState, SYNC_INTERVAL_MS);
    postState();
  },
});

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function numberText(selector: string): number {
  const value = Number(text(selector));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function safeNonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : fallback;
}

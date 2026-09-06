// Shared message types for the MAIN-world <-> isolated-world postMessage channel.
// Each bundle compiles its own copy; only plain-data types cross the boundary.

export const M2_SOURCE = 'm2' as const;
export const M2_4989_CHANNEL = 'freegaku-4989' as const;
export const M2_4989_PROTOCOL_VERSION = 3 as const;

export interface TrackInfo {
  /** Timedtext URL as provided by the player/InnerTube (may already carry pot=). */
  url: string;
  languageCode: string;
  /** 'asr' for auto-generated tracks. */
  kind: '' | 'asr';
  label: string;
}

export interface VideoTracksPayload {
  /** null when the current page is not a video page. */
  videoId: string | null;
  title: string;
  author: string;
  /** Which discovery tier produced the tracks. */
  source: 'player' | 'innertube' | 'netflix' | 'none';
  tracks: TrackInfo[];
  /** ytcfg INNERTUBE_CLIENT_NAME/_VERSION — timedtext wants c= and cver= params. */
  clientName?: string;
  clientVersion?: string;
}

export type M2Message =
  | { source: typeof M2_SOURCE; type: 'tracks'; payload: VideoTracksPayload }
  | { source: typeof M2_SOURCE; type: 'youglish-result'; payload: YouglishResultPayload }
  | { source: typeof M2_SOURCE; type: 'youglish-transcript-fallback'; videoId: string }
  | { source: typeof M2_SOURCE; type: 'refresh' }
  /** Player-sourced caption URL returned an empty body (bad/missing POT) —
   * ask the MAIN world for InnerTube-sourced tracks instead. */
  | { source: typeof M2_SOURCE; type: 'fallback'; videoId: string }
  /** Playback control relayed to the MAIN world (Netflix: only player.seek()
   * is safe — setting video.currentTime breaks the cadmium player). */
  | { source: typeof M2_SOURCE; type: 'control'; action: 'seek' | 'play' | 'pause'; ms?: number };

// --- chrome.runtime messages (content script <-> service worker) ---

export type MineMode = 'update' | 'basic';

export interface MineRequestMessage {
  type: 'm2-mine';
  /** 'update' = enrich last Yomitan-mined MINING note; 'basic' = new Basic note. */
  mode: MineMode;
  /** Front text for mode 'basic' (raw, unescaped). */
  front?: string;
  /** base64 MP3 (no data: prefix) */
  audioBase64: string | null;
  /** base64 JPEG (no data: prefix) */
  imageBase64: string | null;
  /** Raw text of the selected subtitle line(s), unescaped. */
  lines: string[];
  /** Pins the exact note checked before capture; presence authorizes a confirmed mismatch. */
  targetOverride?: TargetOverride;
  video: {
    id: string;
    title: string;
    author: string;
    startSec: number;
    /** Timestamped watch URL for the Origin field (site-specific). */
    url: string;
  };
}

export interface TargetOverride {
  noteId: number;
  word: string;
}

export type MineResponse =
  | { ok: true; word: string; noteId?: number }
  | { ok: false; error: string }
  | {
      ok: false;
      code: 'target-word-mismatch';
      error: string;
      target: TargetOverride;
    };

export type TargetCheckResponse =
  | { ok: true; target: TargetOverride }
  | Extract<MineResponse, { ok: false }>;

// --- 4989 web app bridge ---------------------------------------------------

export interface M24989MinePayload {
  mode: MineMode;
  /** Front text for mode 'basic' (raw, unescaped). */
  front?: string;
  /** Full custom-script lines touched by the selection. */
  lines: string[];
  /** Exact selected text, retained for future field mappings. */
  selectedText: string;
  /** Exact note checked before capture; presence authorizes a confirmed mismatch. */
  targetOverride?: TargetOverride;
  capture: {
    startMs: number;
    endMs: number;
    imageMs: number;
  };
  video: MineRequestMessage['video'];
}

export type M24989PageRequest =
  | {
      channel: typeof M2_4989_CHANNEL;
      version: typeof M2_4989_PROTOCOL_VERSION;
      source: '4989';
      type: 'probe';
    }
  | {
      channel: typeof M2_4989_CHANNEL;
      version: typeof M2_4989_PROTOCOL_VERSION;
      source: '4989';
      type: 'target-check';
      requestId: string;
      lines: string[];
    }
  | {
      channel: typeof M2_4989_CHANNEL;
      version: typeof M2_4989_PROTOCOL_VERSION;
      source: '4989';
      type: 'mine';
      requestId: string;
      payload: M24989MinePayload;
    };

export type M24989PageResponse =
  | {
      channel: typeof M2_4989_CHANNEL;
      version: typeof M2_4989_PROTOCOL_VERSION;
      source: 'freegaku';
      type: 'ready';
    }
  | {
      channel: typeof M2_4989_CHANNEL;
      version: typeof M2_4989_PROTOCOL_VERSION;
      source: 'freegaku';
      type: 'status';
      requestId: string;
      phase: 'checking-anki' | 'capturing' | 'updating-anki';
    }
  | {
      channel: typeof M2_4989_CHANNEL;
      version: typeof M2_4989_PROTOCOL_VERSION;
      source: 'freegaku';
      type: 'result';
      requestId: string;
      result: MineResponse | TargetCheckResponse;
    };

export interface M24989RuntimeMineRequest {
  type: 'm2-4989-mine';
  requestId: string;
  payload: M24989MinePayload;
}

export interface M24989RuntimeStatus {
  type: 'm2-4989-status';
  requestId: string;
  phase: Extract<M24989PageResponse, { type: 'status' }>['phase'];
}

export interface M2EmbedCaptureRequest {
  type: 'm2-embed-capture';
  capture: M24989MinePayload['capture'];
  options?: {
    padStartMs?: number;
    padEndMs?: number;
    imageMaxWidth?: number;
    jpegQuality?: number;
  };
}

export interface M2EmbedStateRequest {
  type: 'm2-embed-state';
}

export interface M2EmbedControlRequest {
  type: 'm2-embed-control';
  action: 'seek' | 'play' | 'pause';
  ms?: number;
}

export interface M2EmbedTranscriptRequest {
  type: 'm2-embed-transcript';
  videoId: string;
  languageCode?: string;
}

export type M2EmbedRequest =
  | M2EmbedCaptureRequest
  | M2EmbedStateRequest
  | M2EmbedControlRequest
  | M2EmbedTranscriptRequest;

export interface M2EmbedState {
  currentTimeMs: number;
  paused: boolean;
  videoId: string | null;
}

export interface M2YouglishEmbedRequest {
  type: 'm2-youglish-embed';
  request: M2EmbedRequest;
}

export interface M2TargetCheckRequest {
  type: 'm2-target-check';
  mode: MineMode;
  lines: string[];
  targetOverride?: TargetOverride;
}

export type M2EmbedCaptureResponse =
  | { ok: true; audioBase64: string; imageBase64: string | null; videoId: string | null }
  | { ok: false; error: string };

export type M2EmbedStateResponse =
  | { ok: true; state: M2EmbedState }
  | { ok: false; error: string };

export type M2EmbedControlResponse = M2EmbedStateResponse;

export type M2EmbedTranscriptResponse =
  | {
      ok: true;
      videoId: string;
      cues: Array<{ text: string; startMs: number; endMs: number }>;
    }
  | { ok: false; error: string };

export type M2EmbedResponse =
  | M2EmbedCaptureResponse
  | M2EmbedStateResponse
  | M2EmbedControlResponse
  | M2EmbedTranscriptResponse;

export interface YouglishResultPayload {
  index: number;
  total: number;
  query: string;
  text: string;
  videoId: string;
  startMs: number;
  endMs: number;
  title: string;
  cues: Array<{
    text: string;
    startMs: number;
    endMs: number;
  }>;
}

export function isM24989PageRequest(value: unknown): value is M24989PageRequest {
  if (!isRecord(value)) return false;
  if (
    value.channel !== M2_4989_CHANNEL ||
    value.version !== M2_4989_PROTOCOL_VERSION ||
    value.source !== '4989'
  ) {
    return false;
  }
  if (value.type === 'probe') return true;
  if (value.type === 'target-check') {
    return (
      typeof value.requestId === 'string' && value.requestId.length > 0 && isLines(value.lines)
    );
  }
  return (
    value.type === 'mine' &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    isM24989MinePayload(value.payload)
  );
}

export function isM24989MinePayload(value: unknown): value is M24989MinePayload {
  if (!isRecord(value) || !isRecord(value.capture) || !isRecord(value.video)) return false;
  return (
    (value.mode === 'update' || value.mode === 'basic') &&
    (value.front === undefined || typeof value.front === 'string') &&
    (value.targetOverride === undefined || isTargetOverride(value.targetOverride)) &&
    isLines(value.lines) &&
    typeof value.selectedText === 'string' &&
    value.selectedText.length <= 50_000 &&
    isCaptureWindow(value.capture) &&
    typeof value.video.id === 'string' &&
    value.video.id.length > 0 &&
    typeof value.video.title === 'string' &&
    typeof value.video.author === 'string' &&
    typeof value.video.startSec === 'number' &&
    Number.isFinite(value.video.startSec) &&
    typeof value.video.url === 'string' &&
    value.video.url.startsWith('https://')
  );
}

export function isM2EmbedRequest(value: unknown): value is M2EmbedRequest {
  if (!isRecord(value)) return false;
  if (value.type === 'm2-embed-state') return true;
  if (value.type === 'm2-embed-transcript') {
    if (typeof value.videoId !== 'string' || !/^[\w-]{11}$/.test(value.videoId)) return false;
    return (
      value.languageCode === undefined ||
      (typeof value.languageCode === 'string' &&
        /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value.languageCode))
    );
  }
  if (value.type === 'm2-embed-control') {
    if (value.action === 'play' || value.action === 'pause') return value.ms === undefined;
    return (
      value.action === 'seek' &&
      typeof value.ms === 'number' &&
      Number.isFinite(value.ms) &&
      value.ms >= 0 &&
      value.ms <= 86_400_000
    );
  }
  if (value.type !== 'm2-embed-capture' || !isCaptureWindow(value.capture)) return false;
  if (value.options === undefined) return true;
  if (!isRecord(value.options)) return false;
  return (
    isOptionalNumberInRange(value.options.padStartMs, 0, 10_000) &&
    isOptionalNumberInRange(value.options.padEndMs, 0, 10_000) &&
    isOptionalNumberInRange(value.options.imageMaxWidth, 64, 4096) &&
    isOptionalNumberInRange(value.options.jpegQuality, 0.1, 1)
  );
}

export function isCaptureWindow(value: unknown): value is M24989MinePayload['capture'] {
  if (!isRecord(value)) return false;
  const { startMs, endMs, imageMs } = value;
  return (
    [startMs, endMs, imageMs].every(
      (time) => typeof time === 'number' && Number.isFinite(time),
    ) &&
    typeof startMs === 'number' &&
    typeof endMs === 'number' &&
    typeof imageMs === 'number' &&
    startMs >= 0 &&
    endMs > startMs &&
    endMs - startMs <= 30_000 &&
    imageMs >= startMs &&
    imageMs <= endMs
  );
}

export function isYouglishResultPayload(value: unknown): value is YouglishResultPayload {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.index) &&
    (value.index as number) > 0 &&
    Number.isSafeInteger(value.total) &&
    (value.total as number) >= (value.index as number) &&
    typeof value.query === 'string' &&
    value.query.length > 0 &&
    value.query.length <= 500 &&
    typeof value.text === 'string' &&
    value.text.length > 0 &&
    value.text.length <= 10_000 &&
    typeof value.videoId === 'string' &&
    /^[\w-]{11}$/.test(value.videoId) &&
    typeof value.startMs === 'number' &&
    typeof value.endMs === 'number' &&
    isCaptureWindow({
      startMs: value.startMs,
      endMs: value.endMs,
      imageMs: value.startMs + (value.endMs - value.startMs) / 2,
    }) &&
    typeof value.title === 'string' &&
    value.title.length <= 1_000 &&
    Array.isArray(value.cues) &&
    value.cues.length > 0 &&
    value.cues.length <= 10_000 &&
    value.cues.every(
      (cue) =>
        isRecord(cue) &&
        typeof cue.text === 'string' &&
        cue.text.length > 0 &&
        cue.text.length <= 10_000 &&
        typeof cue.startMs === 'number' &&
        typeof cue.endMs === 'number' &&
        isCaptureWindow({
          startMs: cue.startMs,
          endMs: cue.endMs,
          imageMs: cue.startMs + (cue.endMs - cue.startMs) / 2,
        }),
    )
  );
}

function isLines(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 50 &&
    value.every((line) => typeof line === 'string' && line.length > 0 && line.length <= 10_000)
  );
}

function isTargetOverride(value: unknown): value is TargetOverride {
  return (
    isRecord(value) &&
    typeof value.noteId === 'number' &&
    Number.isSafeInteger(value.noteId) &&
    value.noteId > 0 &&
    typeof value.word === 'string' &&
    value.word.length > 0 &&
    value.word.length <= 10_000
  );
}

export function isM2Message(data: unknown): data is M2Message {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === M2_SOURCE
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOptionalNumberInRange(value: unknown, min: number, max: number): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
  );
}

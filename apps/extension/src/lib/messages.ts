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
}

export interface M2TargetCheckRequest {
  type: 'm2-target-check';
  mode: MineMode;
  lines: string[];
  targetOverride?: TargetOverride;
}

export type M2EmbedCaptureResponse =
  | { ok: true; audioBase64: string; imageBase64: string | null }
  | { ok: false; error: string };

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
  const { startMs, endMs, imageMs } = value.capture;
  const finiteTimes = [startMs, endMs, imageMs].every(
    (time) => typeof time === 'number' && Number.isFinite(time),
  );
  return (
    (value.mode === 'update' || value.mode === 'basic') &&
    (value.front === undefined || typeof value.front === 'string') &&
    (value.targetOverride === undefined || isTargetOverride(value.targetOverride)) &&
    isLines(value.lines) &&
    typeof value.selectedText === 'string' &&
    value.selectedText.length <= 50_000 &&
    finiteTimes &&
    typeof startMs === 'number' &&
    typeof endMs === 'number' &&
    typeof imageMs === 'number' &&
    startMs >= 0 &&
    endMs > startMs &&
    endMs - startMs <= 30_000 &&
    imageMs >= startMs &&
    imageMs <= endMs &&
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

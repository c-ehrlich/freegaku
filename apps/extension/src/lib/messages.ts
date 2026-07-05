// Shared message types for the MAIN-world <-> isolated-world postMessage channel.
// Each bundle compiles its own copy; only plain-data types cross the boundary.

export const M2_SOURCE = 'm2' as const;

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
  source: 'player' | 'innertube' | 'none';
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
  | { source: typeof M2_SOURCE; type: 'fallback'; videoId: string };

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
  video: { id: string; title: string; author: string; startSec: number };
}

export type MineResponse = { ok: true; word: string } | { ok: false; error: string };

export function isM2Message(data: unknown): data is M2Message {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === M2_SOURCE
  );
}

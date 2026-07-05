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
}

export type M2Message =
  | { source: typeof M2_SOURCE; type: 'tracks'; payload: VideoTracksPayload }
  | { source: typeof M2_SOURCE; type: 'refresh' };

export function isM2Message(data: unknown): data is M2Message {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === M2_SOURCE
  );
}

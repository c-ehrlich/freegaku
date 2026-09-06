export interface YouglishClip {
  text: string;
  videoId: string;
  startMs: number;
  endMs: number;
}

export function normalizeYouglishClip(
  value: unknown,
  currentVideoId?: unknown,
): YouglishClip | null {
  if (!isRecord(value)) return null;
  const startSec = numberValue(value.start);
  const endSec = numberValue(value.end);
  const videoId = validVideoId(currentVideoId) ?? validVideoId(value.vid);
  if (
    typeof value.display !== 'string' ||
    value.display.trim().length === 0 ||
    value.display.length > 10_000 ||
    !videoId ||
    startSec === null ||
    endSec === null ||
    startSec < 0 ||
    endSec <= startSec ||
    endSec - startSec > 30
  ) {
    return null;
  }
  return {
    text: cleanDisplay(value.display),
    videoId,
    startMs: Math.round(startSec * 1000),
    endMs: Math.round(endSec * 1000),
  };
}

export function normalizeYouglishTranscript(
  value: unknown,
  videoId: unknown,
): YouglishClip[] {
  const normalizedVideoId = validVideoId(videoId);
  if (!normalizedVideoId || !isRecord(value) || !Array.isArray(value.results)) return [];
  const seenEntries = new Set<string>();
  const entries = value.results
    .map((result) => normalizeTranscriptEntry(result))
    .filter((entry): entry is TranscriptEntry => entry !== null)
    .sort((a, b) => a.startMs - b.startMs)
    .filter((entry) => {
      const key = `${entry.startMs}:${entry.text}`;
      if (seenEntries.has(key)) return false;
      seenEntries.add(key);
      return true;
    });
  const clips = entries.map((entry, index): YouglishClip => {
    const explicitEndMs = entry.endMs;
    const nextStartMs = entries[index + 1]?.startMs;
    const inferredEndMs =
      explicitEndMs !== null && explicitEndMs > entry.startMs
        ? explicitEndMs
        : nextStartMs && nextStartMs > entry.startMs
          ? nextStartMs
          : entry.startMs + 5_000;
    return {
      text: entry.text,
      videoId: normalizedVideoId,
      startMs: entry.startMs,
      endMs: Math.min(inferredEndMs, entry.startMs + 30_000),
    };
  });
  const seen = new Set<string>();
  return clips.filter((clip) => {
    const key = `${clip.startMs}:${clip.endMs}:${clip.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface TranscriptEntry {
  text: string;
  startMs: number;
  endMs: number | null;
}

function normalizeTranscriptEntry(value: unknown): TranscriptEntry | null {
  if (!isRecord(value) || typeof value.display !== 'string') return null;
  const text = cleanDisplay(value.display);
  const startSec = numberValue(value.start);
  const endSec = numberValue(value.end);
  if (!text || startSec === null || startSec < 0) return null;
  return {
    text,
    startMs: Math.round(startSec * 1000),
    endMs: endSec === null ? null : Math.round(endSec * 1000),
  };
}

function cleanDisplay(display: string): string {
  if (display.length > 10_000) return '';
  return display
    // YouGlish replaces String.prototype.replaceAll with a regex-based shim
    // that throws on the literal `[[[` marker.
    .split('[[[').join('')
    .split(']]]').join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function validVideoId(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]{11}$/.test(value) ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

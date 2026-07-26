import type { SubtitleCue, WordTiming } from '@migaku2/subtitles';

export interface SelectionOffsets {
  startOffset?: number;
  endOffset?: number;
}

export interface CaptureTiming {
  windowStartMs: number;
  windowEndMs: number;
  startMs: number;
  endMs: number;
  imageMs: number;
  cueRanges: Array<{ startMs: number; endMs: number }>;
}

/** Build the local editor window and smart initial handles for touched cues. */
export function captureTimingForSelection(
  cues: SubtitleCue[],
  offsets: SelectionOffsets,
): CaptureTiming | null {
  const first = cues[0];
  const last = cues.at(-1);
  if (!first || !last) return null;

  const windowStartMs = first.start;
  const windowEndMs = last.end;
  let startMs = selectionBoundary(first, offsets.startOffset, 'start');
  let endMs = selectionBoundary(last, offsets.endOffset, 'end');
  if (endMs - startMs < 250) {
    const midpoint = startMs + (endMs - startMs) / 2;
    startMs = Math.max(windowStartMs, midpoint - 125);
    endMs = Math.min(windowEndMs, startMs + 250);
    startMs = Math.max(windowStartMs, endMs - 250);
  }

  return {
    windowStartMs,
    windowEndMs,
    startMs,
    endMs,
    imageMs: startMs + (endMs - startMs) / 2,
    cueRanges: cues.map((cue) => ({ startMs: cue.start, endMs: cue.end })),
  };
}

function selectionBoundary(
  cue: SubtitleCue,
  offset: number | undefined,
  edge: 'start' | 'end',
): number {
  const timed = wordBoundary(cue, offset, edge);
  if (timed !== null) return timed;
  if (offset === undefined || cue.text.length === 0) {
    return edge === 'start' ? cue.start : cue.end;
  }
  const ratio = Math.min(1, Math.max(0, offset / cue.text.length));
  return cue.start + (cue.end - cue.start) * ratio;
}

function wordBoundary(
  cue: SubtitleCue,
  offset: number | undefined,
  edge: 'start' | 'end',
): number | null {
  if (offset === undefined || !cue.words || cue.words.length === 0) return null;
  const rawText = cue.words.map((word) => word.text).join('');
  const leadingTrim = rawText.length - rawText.trimStart().length;
  const rawOffset = Math.max(leadingTrim, Math.min(rawText.length, offset + leadingTrim));
  let cursor = 0;
  let previous: WordTiming | undefined;

  for (const word of cue.words) {
    const wordStart = cursor;
    cursor += word.text.length;
    if (
      rawOffset < cursor ||
      (edge === 'end' && rawOffset === cursor) ||
      (edge === 'start' && rawOffset === wordStart)
    ) {
      return edge === 'start' ? word.start : word.end;
    }
    previous = word;
  }

  return previous ? (edge === 'start' ? previous.start : previous.end) : null;
}

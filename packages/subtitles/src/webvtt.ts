import type { SubtitleCue } from './types';

interface ParsedCue extends SubtitleCue {
  index: number;
}

const TIMING_RE =
  /^(?<start>(?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+(?<end>(?:\d+:)?\d{2}:\d{2}\.\d{3})(?:\s+.*)?$/;
const RT_RE = /<rt(?:\.[^\s>]*)*(?:\s[^>]*)?>[\s\S]*?<\/rt>/gi;
const TAG_RE = /<[^>]*>/g;
const DIRECTIONAL_MARK_RE = /&(?:lrm|rlm);|\u200e|\u200f/gi;

export function parseWebVtt(vtt: string): SubtitleCue[] {
  if (vtt.length === 0) {
    return [];
  }

  const normalized = vtt.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const lines = normalized.split('\n');
  const contentLines = lines.slice(findCueListStart(lines));
  const blocks = contentLines.join('\n').split(/\n[ \t]*\n/);
  const cues: ParsedCue[] = [];

  for (const block of blocks) {
    const cue = parseBlock(block, cues.length);
    if (cue !== undefined) {
      cues.push(cue);
    }
  }

  cues.sort((a, b) => a.start - b.start || a.index - b.index);

  return cues.map(({ start, end, text }) => ({ start, end, text }));
}

function findCueListStart(lines: string[]): number {
  const firstLine = lines[0];
  if (firstLine === undefined || !firstLine.startsWith('WEBVTT')) {
    return 0;
  }

  let cursor = 1;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line === undefined) {
      break;
    }

    if (line.trim() === '') {
      return cursor + 1;
    }

    if (line.includes('-->')) {
      return cursor;
    }

    cursor += 1;
  }

  return cursor;
}

function parseBlock(block: string, index: number): ParsedCue | undefined {
  const lines = block.split('\n');
  const firstContentLine = lines.find((line) => line.trim() !== '');
  if (firstContentLine === undefined || isIgnoredBlock(firstContentLine)) {
    return undefined;
  }

  const timingLineIndex = lines.findIndex((line) => TIMING_RE.test(line.trim()));
  if (timingLineIndex < 0) {
    return undefined;
  }

  const timingLine = lines[timingLineIndex];
  if (timingLine === undefined) {
    return undefined;
  }

  const timing = parseTimingLine(timingLine.trim());
  if (timing === undefined || timing.end <= timing.start) {
    return undefined;
  }

  const text = cleanCueText(lines.slice(timingLineIndex + 1).join('\n'));
  if (text.length === 0) {
    return undefined;
  }

  return {
    start: timing.start,
    end: timing.end,
    text,
    index,
  };
}

function isIgnoredBlock(firstLine: string): boolean {
  return /^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(firstLine.trim());
}

function parseTimingLine(line: string): Pick<SubtitleCue, 'start' | 'end'> | undefined {
  const match = TIMING_RE.exec(line);
  const startText = match?.groups?.start;
  const endText = match?.groups?.end;
  if (startText === undefined || endText === undefined) {
    return undefined;
  }

  const start = parseTimestamp(startText);
  const end = parseTimestamp(endText);
  if (start === undefined || end === undefined) {
    return undefined;
  }

  return { start, end };
}

function parseTimestamp(timestamp: string): number | undefined {
  const parts = timestamp.split(':');
  const secondsText = parts.at(-1);
  const minutesText = parts.at(-2);
  const hoursText = parts.length === 3 ? parts[0] : undefined;
  if (secondsText === undefined || minutesText === undefined || parts.length < 2 || parts.length > 3) {
    return undefined;
  }

  const secondsParts = secondsText.split('.');
  const seconds = parseInteger(secondsParts[0]);
  const milliseconds = parseInteger(secondsParts[1]);
  const minutes = parseInteger(minutesText);
  const hours = hoursText === undefined ? 0 : parseInteger(hoursText);
  if (seconds === undefined || milliseconds === undefined || minutes === undefined || hours === undefined) {
    return undefined;
  }

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function cleanCueText(text: string): string {
  return decodeEntities(text.replace(RT_RE, '').replace(TAG_RE, ''))
    .replace(DIRECTIONAL_MARK_RE, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => decodeCodePoint(entity, Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (entity, decimal: string) => decodeCodePoint(entity, Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function decodeCodePoint(entity: string, codePoint: number): string {
  try {
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
  } catch {
    return entity;
  }
}

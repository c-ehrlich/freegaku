import type { SubtitleCue, WordTiming } from './types';

interface ParsedEvent {
  start: number;
  end: number;
  text: string;
  index: number;
  words?: WordTiming[];
}

interface STag {
  attrs: Record<string, string>;
  body: string;
}

const P_TAG_RE = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
const S_TAG_RE = /<s\b([^>]*)>([\s\S]*?)<\/s>/gi;
const ATTR_RE = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;

export function parseSrv3(xml: string): SubtitleCue[] {
  if (!xml) {
    return [];
  }

  const events: ParsedEvent[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  P_TAG_RE.lastIndex = 0;
  while ((match = P_TAG_RE.exec(xml)) !== null) {
    const rawAttrs = match[1] ?? '';
    const body = match[2] ?? '';
    const attrs = parseAttrs(rawAttrs);
    const start = parseMs(attrs.t);

    if (start === undefined) {
      continue;
    }

    const duration = parseMs(attrs.d) ?? 0;
    const end = start + duration;
    const parsed = parseCueBody(body, attrs, start, duration);

    events.push({
      start,
      end,
      text: parsed.text,
      index,
      words: parsed.words,
    });
    index += 1;
  }

  events.sort((a, b) => a.start - b.start || a.index - b.index);

  const cues: SubtitleCue[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === undefined) {
      continue;
    }

    const text = event.text.trim();
    if (text.length === 0) {
      continue;
    }

    const nextStart = findNextStart(events, i, event.start);
    const clampedEnd = nextStart === undefined ? event.end : Math.min(event.end, nextStart);
    if (clampedEnd <= event.start) {
      continue;
    }

    const cue: SubtitleCue = {
      start: event.start,
      end: clampedEnd,
      text,
    };

    if (event.words !== undefined) {
      const words = clampWords(event.words, clampedEnd);
      if (words.length > 0) {
        cue.words = words;
      }
    }

    cues.push(cue);
  }

  return cues;
}

function parseCueBody(
  body: string,
  attrs: Record<string, string>,
  parentStart: number,
  parentDuration: number,
): Pick<SubtitleCue, 'text' | 'words'> {
  const sTags = parseSTags(body);
  if (isAsrCue(body, attrs, sTags)) {
    const words = parseWords(sTags, parentStart, parentDuration);
    return {
      text: words.map((word) => word.text).join('').trim(),
      words,
    };
  }

  return {
    text: stripTagsAndDecode(body).trim(),
  };
}

function parseWords(sTags: STag[], parentStart: number, parentDuration: number): WordTiming[] {
  const wordParts = sTags.map((tag) => ({
    offset: parseMs(tag.attrs.t) ?? 0,
    text: stripTagsAndDecode(tag.body),
  }));

  const words: WordTiming[] = [];
  for (let i = 0; i < wordParts.length; i += 1) {
    const word = wordParts[i];
    if (word === undefined) {
      continue;
    }

    const nextWord = wordParts[i + 1];
    const endOffset = nextWord === undefined ? parentDuration : nextWord.offset;
    words.push({
      start: parentStart + word.offset,
      end: parentStart + endOffset,
      text: word.text,
    });
  }

  return words;
}

function clampWords(words: WordTiming[], cueEnd: number): WordTiming[] {
  const clamped: WordTiming[] = [];
  for (const word of words) {
    const end = Math.min(word.end, cueEnd);
    if (end > word.start) {
      clamped.push({
        start: word.start,
        end,
        text: word.text,
      });
    }
  }

  return clamped;
}

function findNextStart(events: ParsedEvent[], currentIndex: number, currentStart: number): number | undefined {
  for (let i = currentIndex + 1; i < events.length; i += 1) {
    const next = events[i];
    if (next !== undefined && next.start > currentStart) {
      return next.start;
    }
  }

  return undefined;
}

function parseSTags(body: string): STag[] {
  const tags: STag[] = [];
  let match: RegExpExecArray | null;

  S_TAG_RE.lastIndex = 0;
  while ((match = S_TAG_RE.exec(body)) !== null) {
    tags.push({
      attrs: parseAttrs(match[1] ?? ''),
      body: match[2] ?? '',
    });
  }

  return tags;
}

function isAsrCue(body: string, attrs: Record<string, string>, sTags: STag[]): boolean {
  if (sTags.length === 0) {
    return false;
  }

  if (attrs.w !== undefined) {
    return true;
  }

  return sTags.some((tag) => tag.attrs.t !== undefined || tag.attrs.ac !== undefined);
}

function stripTagsAndDecode(input: string): string {
  return decodeEntities(input.replace(BR_RE, '\n').replace(TAG_RE, ''));
}

function parseAttrs(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;

  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(input)) !== null) {
    const name = match[1];
    if (name === undefined) {
      continue;
    }

    attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }

  return attrs;
}

function parseMs(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => decodeCodePoint(entity, Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (entity, decimal: string) => decodeCodePoint(entity, Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function decodeCodePoint(entity: string, codePoint: number): string {
  try {
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
  } catch {
    return entity;
  }
}

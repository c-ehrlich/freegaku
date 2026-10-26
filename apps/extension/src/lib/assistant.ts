import type { SubtitleCue } from '@migaku2/subtitles';
import type { AssistantTurn, TranscriptCue, VideoInfo } from './messages';

// Prompt pieces shared by explanations and summaries. Pure (no DOM, no
// network) so they can be unit-tested.

export interface ChatTextPart {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatTextPart[];
}

const SITE_LABELS: Record<VideoInfo['site'], string> = {
  youtube: 'YouTube',
  netflix: 'Netflix',
  youglish: 'YouGlish (YouTube clips found by searching for a word)',
  '4989': '4989 American Life (YouTube channel; the transcript is the official script)',
};

const LANGUAGE_NAMES: Record<string, string> = {
  ja: 'Japanese',
  en: 'English',
  zh: 'Chinese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

/** 'ja-JP' → 'ja'. */
export function baseLanguage(code: string): string {
  return code.toLowerCase().split(/[-_]/)[0] ?? '';
}

export function languageName(code: string): string {
  return LANGUAGE_NAMES[baseLanguage(code)] ?? (code || 'the target language');
}

export function toTranscriptCues(cues: SubtitleCue[]): TranscriptCue[] {
  return cues.map((c) => ({ text: c.text, startMs: c.start, endMs: c.end }));
}

/** Drops empty details so the prompt has no blank labels. */
export function withoutEmptyDetails<T extends VideoInfo>(info: T): T {
  return { ...info, details: info.details.filter((d) => d.value.trim().length > 0) };
}

export function videoBlock(info: VideoInfo): string[] {
  const lines: string[] = ['<video>', `Site: ${SITE_LABELS[info.site]}`];
  if (info.title) lines.push(`Title: ${info.title}`);
  for (const { label, value } of info.details) lines.push(`${label}: ${value.trim()}`);
  lines.push('</video>');
  return lines;
}

export function transcriptOpenTag(info: VideoInfo): string {
  return `<transcript${info.language ? ` language="${info.language}"` : ''}>`;
}

/** One transcript line as the model sees it: `[mm:ss] text`. */
export function transcriptLine(cue: TranscriptCue, marker = ''): string {
  return `${marker}[${formatClock(cue.startMs)}] ${cue.text.replace(/\s*\n\s*/g, ' ')}`;
}

/** OpenAI-style chat messages for OpenRouter. The context block is its own
 * cache-marked part so follow-ups reuse the cached transcript. */
export function buildChatMessages(
  system: string,
  contextBlock: string,
  history: AssistantTurn[],
  question: string,
  defaultQuestion: string,
): ChatMessage[] {
  const turns = [...history, { question, answer: '' }];
  const ask = (q: string): string => q.trim() || defaultQuestion;
  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  turns.forEach((turn, i) => {
    if (i === 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: contextBlock, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: ask(turn.question) },
        ],
      });
    } else {
      messages.push({ role: 'user', content: ask(turn.question) });
    }
    if (i < turns.length - 1) messages.push({ role: 'assistant', content: turn.answer });
  });
  return messages;
}

export function formatCost(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${Number(usd.toPrecision(3))}`;
  return `$${usd.toFixed(3)}`;
}

/** Incremental server-sent-events parser: feed text chunks, get `data:` payloads. */
export function createSseParser(onData: (data: string) => void): { push(chunk: string): void } {
  let buffer = '';
  return {
    push(chunk: string) {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) onData(line.slice(5).trimStart());
      }
    },
  };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

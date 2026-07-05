// Freegaku transcription worker: receives short WAV chunks from the
// extension, forwards them to an OpenAI-compatible Whisper endpoint, and
// returns video-timeline-aligned segments.

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  MOCK_ASR?: string;
}

interface OutSegment {
  /** ms on the video timeline */
  startMs: number;
  endMs: number;
  text: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (url.pathname === '/health') {
      return json({ ok: true, mock: env.MOCK_ASR === '1', hasKey: Boolean(env.OPENAI_API_KEY) });
    }
    if (url.pathname === '/transcribe' && request.method === 'POST') {
      try {
        return await transcribe(request, env, url);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

async function transcribe(request: Request, env: Env, url: URL): Promise<Response> {
  const offsetMs = Number(url.searchParams.get('offsetMs') ?? '0');
  /** Audio seconds → video ms multiplier (captures made at >1x playback). */
  const scale = Number(url.searchParams.get('scale') ?? '1');
  const lang = url.searchParams.get('lang') ?? undefined;
  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0) return json({ error: 'empty audio body' }, 400);
  if (audio.byteLength > 24 * 1024 * 1024) return json({ error: 'chunk too large' }, 413);

  if (env.MOCK_ASR === '1') {
    // Deterministic synthetic output for pipeline tests without an API key.
    const chunkSec = Math.max(1, audio.byteLength / 32000); // 16k mono 16-bit
    const segments: OutSegment[] = [];
    for (let t = 0; t < chunkSec; t += 3) {
      segments.push({
        startMs: Math.round(offsetMs + t * 1000 * scale),
        endMs: Math.round(offsetMs + Math.min(t + 2.5, chunkSec) * 1000 * scale),
        text: `mock segment @${Math.round((offsetMs / 1000 + t * scale) * 10) / 10}s`,
      });
    }
    return json({ segments, mock: true });
  }

  if (!env.OPENAI_API_KEY) {
    return json(
      { error: 'Worker has no OPENAI_API_KEY — put it in apps/worker/.dev.vars' },
      500,
    );
  }

  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', env.OPENAI_MODEL ?? 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (lang) form.append('language', lang);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    segments?: Array<{ start: number; end: number; text: string; no_speech_prob?: number }>;
  };
  const segments: OutSegment[] = (data.segments ?? [])
    .filter((s) => s.text.trim().length > 0 && (s.no_speech_prob ?? 0) < 0.9)
    .map((s) => ({
      startMs: Math.round(offsetMs + s.start * 1000 * scale),
      endMs: Math.round(offsetMs + s.end * 1000 * scale),
      text: s.text.trim(),
    }));
  return json({ segments });
}

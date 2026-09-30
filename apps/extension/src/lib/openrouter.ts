import { createSseParser } from './explain';
import type { ChatMessage } from './explain';

// OpenRouter chat completions, called from the service worker with the
// user's key (host permission in wxt.config.ts).

const API = 'https://openrouter.ai/api/v1';

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly code?: 'no-key' | 'bad-key',
  ) {
    super(message);
  }
}

export interface StreamChatResult {
  text: string;
  model: string;
  costUsd: number | null;
}

interface StreamChunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: {
    cost?: number;
    is_byok?: boolean;
    cost_details?: { upstream_inference_cost?: number };
  };
  error?: { message?: string };
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Freegaku',
  };
}

export async function streamChat(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<StreamChatResult> {
  if (!options.apiKey) throw new OpenRouterError('Add an OpenRouter key in Freegaku settings.', 'no-key');
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: headers(options.apiKey),
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      usage: { include: true },
    }),
    signal: options.signal,
  });
  if (!res.ok || !res.body) throw await responseError(res);

  let text = '';
  let model = options.model;
  let costUsd: number | null = null;
  let streamError: string | null = null;
  const parser = createSseParser((data) => {
    if (data === '[DONE]') return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      return;
    }
    if (chunk.error) streamError = chunk.error.message ?? 'OpenRouter stream error';
    if (chunk.model) model = chunk.model;
    if (chunk.usage) costUsd = usageCost(chunk.usage);
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      options.onDelta(delta);
    }
  });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(value);
  }
  parser.push('\n');
  if (streamError) throw new OpenRouterError(streamError);
  if (!text) throw new OpenRouterError('The model returned an empty answer.');
  return { text, model, costUsd };
}

/** With BYOK, `cost` is only OpenRouter's fee; the provider bills the
 * inference itself, reported as upstream_inference_cost. */
function usageCost(usage: NonNullable<StreamChunk['usage']>): number | null {
  if (typeof usage.cost !== 'number') return null;
  const upstream = usage.is_byok ? (usage.cost_details?.upstream_inference_cost ?? 0) : 0;
  return usage.cost + upstream;
}

/** Key sanity check for the options page: remaining credit and limit. */
export async function checkKey(apiKey: string): Promise<{ label: string; usage: number; limit: number | null }> {
  if (!apiKey) throw new OpenRouterError('No key entered.', 'no-key');
  const res = await fetch(`${API}/key`, { headers: headers(apiKey) });
  if (!res.ok) throw await responseError(res);
  const body = (await res.json()) as { data?: { label?: string; usage?: number; limit?: number | null } };
  return {
    label: body.data?.label ?? '',
    usage: body.data?.usage ?? 0,
    limit: body.data?.limit ?? null,
  };
}

async function responseError(res: Response): Promise<OpenRouterError> {
  let message = `OpenRouter HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    // Non-JSON error body; keep the status message.
  }
  if (res.status === 401) {
    return new OpenRouterError(`OpenRouter rejected the key (${message}). Check it in Freegaku settings.`, 'bad-key');
  }
  if (res.status === 402) return new OpenRouterError(`OpenRouter: out of credits (${message}).`);
  return new OpenRouterError(message);
}

// A stand-in for the WebExtension `browser` global, so the real UI modules run
// in a plain page. Must be imported before anything that touches `browser`.
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import type { AssistantPortClientMessage, AssistantPortServerMessage } from '../src/lib/messages';
import { answerFor } from './fixtures';

type Listener<T> = (value: T) => void;

function event<T>() {
  const listeners: Listener<T>[] = [];
  return {
    addListener: (l: Listener<T>) => listeners.push(l),
    removeListener: (l: Listener<T>) => listeners.splice(listeners.indexOf(l), 1),
    emit: (value: T) => listeners.forEach((l) => l(value)),
  };
}

const storage: Record<string, unknown> = {
  settings: { ...DEFAULT_SETTINGS, openRouterKey: 'sk-or-lab', workerToken: '' },
};

const params = new URLSearchParams(location.search);
/** ?stream=hold keeps answers streaming forever (for the "writing…" state). */
const holdStream = params.get('stream') === 'hold';

const runtime = {
  id: 'lab',
  sendMessage: async (message: unknown) => {
    console.debug('[lab] sendMessage', message);
    return { ok: true };
  },
  connect: () => {
    const onMessage = event<AssistantPortServerMessage>();
    const onDisconnect = event<void>();
    let open = true;
    return {
      onMessage,
      onDisconnect,
      postMessage(start: AssistantPortClientMessage) {
        const text = answerFor(start);
        // Deliver synchronously-ish so screenshots are deterministic.
        queueMicrotask(() => {
          if (!open) return;
          if (holdStream) {
            onMessage.emit({ type: 'delta', text: text.slice(0, Math.floor(text.length * 0.45)) });
            return;
          }
          onMessage.emit({ type: 'delta', text });
          onMessage.emit({
            type: 'done',
            result: { ok: true, text, model: 'anthropic/claude-haiku-5.5', costUsd: 0.0021 },
          });
        });
      },
      disconnect() {
        open = false;
      },
    };
  },
  getURL: (path: string) => path,
};

const onChanged = event<unknown>();

(globalThis as Record<string, unknown>).browser = {
  runtime,
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys == null) return { ...storage };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in storage).map((k) => [k, storage[k]]));
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(storage, items);
      },
      remove: async () => {},
    },
    onChanged,
  },
};

// AnkiConnect, for the options page.
const ANKI: Record<string, unknown> = {
  version: 6,
  deckNames: ['Default', '日本語', '日本語::Mining', '日本語::Netflix'],
  modelNames: ['Basic', 'MINING: 単語', 'MINING: 文法', 'Lapis'],
};
const MINING_FIELDS = ['Word', 'Reading', 'Meaning', 'Sentence', 'Sentence-Audio', 'Image', 'Origin'];
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:8765') || url.startsWith('http://localhost:8765')) {
    const { action, params: p } = JSON.parse(String(init?.body ?? '{}')) as {
      action: string;
      params?: { modelName?: string };
    };
    if (params.get('anki') === 'down') throw new TypeError('Failed to fetch');
    const result =
      action === 'modelFieldNames'
        ? p?.modelName === 'Basic'
          ? ['Front', 'Back']
          : MINING_FIELDS
        : (ANKI[action] ?? null);
    return new Response(JSON.stringify({ result, error: null }));
  }
  if (url.startsWith('https://openrouter.ai/')) {
    return new Response(JSON.stringify({ data: { label: 'lab', usage: 1.42, limit: null } }));
  }
  return realFetch(input, init);
};

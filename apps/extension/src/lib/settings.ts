/** What the miner can write to a card. */
export type MineContent = 'sentenceAudio' | 'image' | 'sentence' | 'origin';

/** Per-note-type mapping: content kind → destination field (null = don't write). */
export interface NoteTypeMapping {
  model: string;
  fields: Record<MineContent, string | null>;
}

export interface M2Settings {
  /** Audio padding before the span start (ms). */
  padStartMs: number;
  /** Audio padding after the span end (ms). */
  padEndMs: number;
  /** Note types eligible for the update-last flow, with their field mappings. */
  mappings: NoteTypeMapping[];
  /** Deck for standalone Basic cards. */
  basicDeck: string;
  /** Note type for standalone cards (Front = prompt, Back = everything). */
  basicModel: string;
  ankiUrl: string;
  /** Letter pressed with Alt to toggle the sidebar / overlay. */
  sidebarKey: string;
  overlayKey: string;
  imageMaxWidth: number;
  /** 0.1–1 */
  jpegQuality: number;
  /** Transcription worker (apps/worker; wrangler dev serves it locally). */
  workerUrl: string;
  /** Bearer token for the worker; empty for an unauthenticated localhost worker. */
  workerToken: string;
  /** ISO-639-1 language hint for Whisper ('' = auto-detect). */
  whisperLang: string;
  /** Playback rate while generating on YouTube (Netflix always 1x). */
  generateRate: number;
}

const DEFAULT_FIELDS: Record<MineContent, string | null> = {
  sentenceAudio: 'Sentence-Audio',
  image: 'Image',
  sentence: 'Sentence',
  origin: 'Origin',
};

export const DEFAULT_SETTINGS: M2Settings = {
  padStartMs: 500,
  padEndMs: 500,
  mappings: [
    { model: 'MINING: 単語', fields: { ...DEFAULT_FIELDS } },
    { model: 'MINING: 文法', fields: { ...DEFAULT_FIELDS, origin: null } },
  ],
  basicDeck: '日本語',
  basicModel: 'Basic',
  ankiUrl: 'http://127.0.0.1:8765',
  sidebarKey: 'G',
  overlayKey: 'S',
  imageMaxWidth: 1280,
  jpegQuality: 0.9,
  workerUrl: 'http://localhost:8787',
  workerToken: '',
  whisperLang: 'ja',
  generateRate: 2,
};

const STORAGE_KEY = 'settings';

export async function getSettings(): Promise<M2Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const partial = (stored[STORAGE_KEY] ?? {}) as Partial<M2Settings> & { noteTypes?: string[] };
  const settings = { ...DEFAULT_SETTINGS, ...partial };
  // Migrate pre-mapping settings ({noteTypes: string[]}).
  if (!partial.mappings && Array.isArray(partial.noteTypes)) {
    settings.mappings = partial.noteTypes.map((model) => ({
      model,
      fields: { ...DEFAULT_FIELDS },
    }));
  }
  return settings;
}

export async function saveSettings(settings: Partial<M2Settings>): Promise<void> {
  const current = await getSettings();
  await browser.storage.local.set({ [STORAGE_KEY]: { ...current, ...settings } });
}

/** Fires with the merged settings whenever they change. */
export function onSettingsChanged(cb: (settings: M2Settings) => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;
    const partial = (changes[STORAGE_KEY]?.newValue ?? {}) as Partial<M2Settings>;
    cb({ ...DEFAULT_SETTINGS, ...partial });
  });
}

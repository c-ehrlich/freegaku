export interface M2Settings {
  /** Audio padding before the span start (ms). */
  padStartMs: number;
  /** Audio padding after the span end (ms). */
  padEndMs: number;
  /** Note types eligible for the update-last flow. */
  noteTypes: string[];
  /** Deck for standalone Basic cards. */
  basicDeck: string;
  /** Note type for standalone cards. */
  basicModel: string;
  ankiUrl: string;
  /** Letter pressed with Alt to toggle the sidebar / overlay. */
  sidebarKey: string;
  overlayKey: string;
  imageMaxWidth: number;
  /** 0.1–1 */
  jpegQuality: number;
}

export const DEFAULT_SETTINGS: M2Settings = {
  padStartMs: 500,
  padEndMs: 500,
  noteTypes: ['MINING: 単語', 'MINING: 文法'],
  basicDeck: '日本語',
  basicModel: 'Basic',
  ankiUrl: 'http://127.0.0.1:8765',
  sidebarKey: 'G',
  overlayKey: 'S',
  imageMaxWidth: 1280,
  jpegQuality: 0.9,
};

const STORAGE_KEY = 'settings';

export async function getSettings(): Promise<M2Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const partial = (stored[STORAGE_KEY] ?? {}) as Partial<M2Settings>;
  return { ...DEFAULT_SETTINGS, ...partial };
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

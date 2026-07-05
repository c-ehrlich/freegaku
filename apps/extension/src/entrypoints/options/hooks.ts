import { useCallback, useEffect, useRef, useState } from 'react';
import { getSettings, saveSettings } from '../../lib/settings';
import type { M2Settings } from '../../lib/settings';

const SAVE_DEBOUNCE_MS = 400;

/** Settings with debounced auto-save. `savedTick` bumps after each write. */
export function useSettings(): {
  settings: M2Settings | null;
  update: (patch: Partial<M2Settings>) => void;
  savedTick: number;
} {
  const [settings, setSettings] = useState<M2Settings | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const update = useCallback((patch: Partial<M2Settings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void saveSettings(next).then(() => setSavedTick((t) => t + 1));
      }, SAVE_DEBOUNCE_MS);
      return next;
    });
  }, []);

  return { settings, update, savedTick };
}

export type AnkiStatus = 'connecting' | 'connected' | 'error';

export interface AnkiData {
  status: AnkiStatus;
  version: number | null;
  error: string | null;
  decks: string[];
  models: string[];
  /** modelName → field names; populated lazily via ensureFields. */
  modelFields: Record<string, string[]>;
  ensureFields: (model: string) => void;
  refresh: () => void;
}

async function invoke<T>(url: string, action: string, params?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action, version: 6, params }),
  });
  const data = (await res.json()) as { result: T; error: string | null };
  if (data.error) throw new Error(data.error);
  return data.result;
}

/** Live AnkiConnect data for the given URL. */
export function useAnki(ankiUrl: string | undefined): AnkiData {
  const [status, setStatus] = useState<AnkiStatus>('connecting');
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelFields, setModelFields] = useState<Record<string, string[]>>({});
  const [refreshTick, setRefreshTick] = useState(0);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (!ankiUrl) return;
    let cancelled = false;
    setStatus('connecting');
    requested.current = new Set();
    void (async () => {
      try {
        const [v, deckNames, modelNames] = await Promise.all([
          invoke<number>(ankiUrl, 'version'),
          invoke<string[]>(ankiUrl, 'deckNames'),
          invoke<string[]>(ankiUrl, 'modelNames'),
        ]);
        if (cancelled) return;
        setVersion(v);
        setDecks(deckNames);
        setModels(modelNames);
        setModelFields({});
        setError(null);
        setStatus('connected');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ankiUrl, refreshTick]);

  const ensureFields = useCallback(
    (model: string) => {
      if (!ankiUrl || status !== 'connected' || !model) return;
      if (requested.current.has(model)) return;
      requested.current.add(model);
      void invoke<string[]>(ankiUrl, 'modelFieldNames', { modelName: model })
        .then((fields) => setModelFields((prev) => ({ ...prev, [model]: fields })))
        .catch(() => requested.current.delete(model));
    },
    [ankiUrl, status],
  );

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  return { status, version, error, decks, models, modelFields, ensureFields, refresh };
}

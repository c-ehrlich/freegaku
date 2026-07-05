import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../../lib/settings';
import type { M2Settings } from '../../lib/settings';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string): T =>
  document.getElementById(id) as T;

const statusEl = $('status');

function setStatus(text: string, kind: 'ok' | 'error'): void {
  statusEl.textContent = text;
  statusEl.className = kind;
  setTimeout(() => {
    if (statusEl.textContent === text) statusEl.textContent = '';
  }, 4000);
}

async function load(): Promise<void> {
  const s = await getSettings();
  $('padStartMs').value = String(s.padStartMs);
  $('padEndMs').value = String(s.padEndMs);
  $('ankiUrl').value = s.ankiUrl;
  $('noteTypes').value = s.noteTypes.join(', ');
  $('basicDeck').value = s.basicDeck;
  $('basicModel').value = s.basicModel;
  $('sidebarKey').value = s.sidebarKey;
  $('overlayKey').value = s.overlayKey;
  $('imageMaxWidth').value = String(s.imageMaxWidth);
  $('jpegQuality').value = String(s.jpegQuality);
}

function num(id: string, fallback: number, min: number, max: number): number {
  const v = Number($(id).value);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function letter(id: string, fallback: string): string {
  const v = $(id)
    .value.trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return v.length === 1 ? v : fallback;
}

async function save(): Promise<void> {
  const settings: M2Settings = {
    padStartMs: num('padStartMs', DEFAULT_SETTINGS.padStartMs, 0, 5000),
    padEndMs: num('padEndMs', DEFAULT_SETTINGS.padEndMs, 0, 5000),
    ankiUrl: $('ankiUrl').value.trim() || DEFAULT_SETTINGS.ankiUrl,
    noteTypes: $('noteTypes')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    basicDeck: $('basicDeck').value.trim() || DEFAULT_SETTINGS.basicDeck,
    basicModel: $('basicModel').value.trim() || DEFAULT_SETTINGS.basicModel,
    sidebarKey: letter('sidebarKey', DEFAULT_SETTINGS.sidebarKey),
    overlayKey: letter('overlayKey', DEFAULT_SETTINGS.overlayKey),
    imageMaxWidth: num('imageMaxWidth', DEFAULT_SETTINGS.imageMaxWidth, 320, 3840),
    jpegQuality: num('jpegQuality', DEFAULT_SETTINGS.jpegQuality, 0.1, 1),
  };
  if (settings.noteTypes.length === 0) settings.noteTypes = DEFAULT_SETTINGS.noteTypes;
  await saveSettings(settings);
  await load(); // reflect normalization
  setStatus('Saved ✓', 'ok');
}

async function ankiInvoke<T>(url: string, action: string, params?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action, version: 6, params }),
  });
  const data = (await res.json()) as { result: T; error: string | null };
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function testAnki(): Promise<void> {
  const url = $('ankiUrl').value.trim() || DEFAULT_SETTINGS.ankiUrl;
  try {
    const version = await ankiInvoke<number>(url, 'version');
    setStatus(`Connected ✓ (AnkiConnect v${version})`, 'ok');
  } catch (e) {
    setStatus(
      `Failed: ${e instanceof Error ? e.message : String(e)} — is Anki open with the AnkiConnect add-on?`,
      'error',
    );
  }
}

/** Populate datalists from Anki so decks/models autocomplete. Best-effort. */
async function populateDatalists(): Promise<void> {
  const url = $('ankiUrl').value.trim() || DEFAULT_SETTINGS.ankiUrl;
  try {
    const [decks, models] = await Promise.all([
      ankiInvoke<string[]>(url, 'deckNames'),
      ankiInvoke<string[]>(url, 'modelNames'),
    ]);
    $('deckList').replaceChildren(
      ...decks.map((d) => Object.assign(document.createElement('option'), { value: d })),
    );
    $('modelList').replaceChildren(
      ...models.map((m) => Object.assign(document.createElement('option'), { value: m })),
    );
  } catch {
    // Anki closed — text inputs still work.
  }
}

$('save').addEventListener('click', () => void save());
$('test').addEventListener('click', () => void testAnki());
void load().then(populateDatalists);

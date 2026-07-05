export interface MineNotePayload {
  /** base64 (no data: prefix) MP3 */
  audio?: { base64: string; filenameHint: string };
  /** base64 JPEG */
  image?: { base64: string; filenameHint: string };
  /** HTML for the Sentence field (lines joined with <br>, already escaped) */
  sentenceHtml?: string;
  /** HTML for the Origin field */
  originHtml?: string;
}

export interface MineResult {
  noteId: number;
  word: string;
}

export class AnkiError extends Error {}

interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

interface AnkiField {
  value: string;
  order: number;
}

interface AnkiNoteInfo {
  fields: Record<string, AnkiField>;
  modelName: string;
}

const DEFAULT_ANKI_URL = 'http://127.0.0.1:8765';
const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MARKUP_RE = /<(b|strong|i|em|u)[^>]*>(.*?)<\/\1>/gi;

export async function updateLastMiningNote(
  payload: MineNotePayload,
  opts: { noteTypes: string[]; ankiUrl?: string },
): Promise<MineResult> {
  const ankiUrl = opts.ankiUrl ?? DEFAULT_ANKI_URL;
  const noteIds = await invoke<number[]>(
    ankiUrl,
    'findNotes',
    { query: `(${opts.noteTypes.map((noteType) => `"note:${noteType}"`).join(' OR ')}) added:2` },
  );

  if (noteIds.length === 0) {
    throw new AnkiError(
      `No note of type ${opts.noteTypes.map((t) => `“${t}”`).join(' / ')} added in the last ` +
        '2 days — mine a word with Yomitan first, then click ＋.',
    );
  }

  const id = Math.max(...noteIds);
  const noteInfos = await invoke<AnkiNoteInfo[]>(ankiUrl, 'notesInfo', { notes: [id] });
  const noteInfo = noteInfos[0];
  if (!noteInfo) {
    throw new AnkiError('Could not read the recent MINING note.');
  }

  const fields: Record<string, string> = {};
  const word = noteInfo.fields.Word?.value ?? '';

  if (payload.audio && hasField(noteInfo, 'Sentence-Audio')) {
    const storedAudioName = await storeMedia(ankiUrl, payload.audio, 'mp3');
    fields['Sentence-Audio'] = `[sound:${storedAudioName}]`;
  }

  if (payload.image && hasField(noteInfo, 'Image')) {
    const storedImageName = await storeMedia(ankiUrl, payload.image, 'jpg');
    fields.Image = `<img src="${storedImageName}">`;
  }

  if (payload.sentenceHtml !== undefined && hasField(noteInfo, 'Sentence')) {
    fields.Sentence = inheritHtmlMarkup(payload.sentenceHtml, noteInfo.fields.Sentence?.value ?? '');
  }

  if (payload.originHtml !== undefined && hasField(noteInfo, 'Origin')) {
    fields.Origin = payload.originHtml;
  }

  await ignoreAnkiError(invoke(ankiUrl, 'guiBrowse', { query: 'nid:1 nid:2' }));
  await invoke(ankiUrl, 'updateNoteFields', { note: { id, fields } });
  await ignoreAnkiError(invoke(ankiUrl, 'guiBrowse', { query: `nid:${id}` }));

  return { noteId: id, word };
}

export interface BasicCardPayload {
  /** HTML for the Front field (already escaped). */
  frontHtml: string;
  audio?: { base64: string; filenameHint: string };
  image?: { base64: string; filenameHint: string };
  sentenceHtml?: string;
  originHtml?: string;
}

/** Standalone card for non-Japanese lines: new Basic note, no Yomitan step. */
export async function createBasicNote(
  payload: BasicCardPayload,
  opts: { deckName: string; modelName?: string; ankiUrl?: string },
): Promise<MineResult> {
  const ankiUrl = opts.ankiUrl ?? DEFAULT_ANKI_URL;
  const backParts: string[] = [];
  if (payload.sentenceHtml) backParts.push(payload.sentenceHtml);
  const mediaParts: string[] = [];
  if (payload.audio) {
    mediaParts.push(`[sound:${await storeMedia(ankiUrl, payload.audio, 'mp3')}]`);
  }
  if (payload.image) {
    mediaParts.push(`<img src="${await storeMedia(ankiUrl, payload.image, 'jpg')}">`);
  }
  if (mediaParts.length > 0) backParts.push(mediaParts.join('<br>'));
  if (payload.originHtml) backParts.push(payload.originHtml);

  const noteId = await invoke<number>(ankiUrl, 'addNote', {
    note: {
      deckName: opts.deckName,
      modelName: opts.modelName ?? 'Basic',
      fields: { Front: payload.frontHtml, Back: backParts.join('<br><br>') },
      options: { allowDuplicate: true },
      tags: ['m2'],
    },
  });
  await ignoreAnkiError(invoke(ankiUrl, 'guiBrowse', { query: `nid:${noteId}` }));
  return { noteId, word: payload.frontHtml };
}

export async function ankiAvailable(ankiUrl = DEFAULT_ANKI_URL): Promise<boolean> {
  try {
    await invoke(ankiUrl, 'version');
    return true;
  } catch {
    return false;
  }
}

export function inheritHtmlMarkup(next: string, prev: string): string {
  const pairs: Array<{ tag: string; text: string }> = [];
  const seen = new Set<string>();

  for (const match of prev.matchAll(MARKUP_RE)) {
    const tag = match[1]?.toLowerCase();
    const inner = match[2];
    if (!tag || inner === undefined) continue;

    const text = stripTags(inner);
    if (text.length === 0) continue;

    const key = `${tag}\u0000${text}`;
    if (seen.has(key)) continue;

    seen.add(key);
    pairs.push({ tag, text });
  }

  let result = next;
  let wrappedMask = new Array<boolean>(result.length).fill(false);

  for (const pair of pairs) {
    const index = findUnwrapped(result, pair.text, wrappedMask);
    if (index === -1) continue;

    const before = result.slice(0, index);
    const matched = result.slice(index, index + pair.text.length);
    const after = result.slice(index + pair.text.length);
    const openTag = `<${pair.tag}>`;
    const closeTag = `</${pair.tag}>`;

    result = `${before}${openTag}${matched}${closeTag}${after}`;
    wrappedMask = [
      ...wrappedMask.slice(0, index),
      ...new Array<boolean>(openTag.length).fill(true),
      ...new Array<boolean>(matched.length).fill(true),
      ...new Array<boolean>(closeTag.length).fill(true),
      ...wrappedMask.slice(index + pair.text.length),
    ];
  }

  return result;
}

async function invoke<T = unknown>(ankiUrl: string, action: string, params?: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch (error) {
    throw new AnkiError(
      `Could not connect to AnkiConnect. Is Anki running with AnkiConnect? ${formatCause(error)}`,
    );
  }

  if (!response.ok) {
    throw new AnkiError(`AnkiConnect returned HTTP ${response.status} ${response.statusText}`.trim());
  }

  let data: AnkiResponse<T>;
  try {
    data = (await response.json()) as AnkiResponse<T>;
  } catch (error) {
    throw new AnkiError(`AnkiConnect returned invalid JSON. ${formatCause(error)}`);
  }

  if (data.error !== null) {
    throw new AnkiError(data.error);
  }

  return data.result;
}

async function storeMedia(
  ankiUrl: string,
  media: { base64: string; filenameHint: string },
  extension: 'mp3' | 'jpg',
): Promise<string> {
  return await invoke<string>(ankiUrl, 'storeMediaFile', {
    filename: `m2_${sanitize(media.filenameHint)}_${randomSuffix()}.${extension}`,
    data: media.base64,
    deleteExisting: false,
  });
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
}

function randomSuffix(): string {
  let suffix = '';

  for (let i = 0; i < 6; i++) {
    const index = Math.floor(Math.random() * RANDOM_ALPHABET.length);
    suffix += RANDOM_ALPHABET[index] ?? '0';
  }

  return suffix;
}

function hasField(noteInfo: AnkiNoteInfo, fieldName: string): boolean {
  return Object.hasOwn(noteInfo.fields, fieldName);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

function findUnwrapped(value: string, text: string, wrappedMask: boolean[]): number {
  let index = value.indexOf(text);

  while (index !== -1) {
    let overlapsWrapped = false;
    for (let i = index; i < index + text.length; i++) {
      if (wrappedMask[i] === true) {
        overlapsWrapped = true;
        break;
      }
    }

    if (!overlapsWrapped) return index;

    index = value.indexOf(text, index + 1);
  }

  return -1;
}

async function ignoreAnkiError(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Best-effort browser focus workaround; failures should not block note updates.
  }
}

function formatCause(error: unknown): string {
  return error instanceof Error && error.message ? `(${error.message})` : '';
}

import { AnkiError, createBasicNote, updateLastMiningNote } from '../lib/anki';
import type { MineRequestMessage, MineResponse } from '../lib/messages';

// AnkiConnect calls must originate from the extension origin — content-script
// fetches carry the page origin, which AnkiConnect rejects.

// Personal build: note types/deck are hardcoded until the options page (milestone 5).
const NOTE_TYPES = ['MINING: 単語', 'MINING: 文法'];
const BASIC_DECK = '日本語'; // same deck as the MINING cards

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (res: MineResponse) => void) => {
      const msg = message as MineRequestMessage;
      if (msg?.type !== 'm2-mine') return;
      void handleMine(msg)
        .then(sendResponse)
        .catch((e) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true; // keep the message channel open for the async response
    },
  );
});

async function handleMine(msg: MineRequestMessage): Promise<MineResponse> {
  try {
    const sentenceHtml = msg.lines.map(escapeHtml).join('<br>');
    const originHtml =
      `<a href="https://youtu.be/${msg.video.id}?t=${msg.video.startSec}">` +
      `${escapeHtml(msg.video.title || msg.video.id)}</a>` +
      (msg.video.author ? ` — ${escapeHtml(msg.video.author)}` : '');
    const filenameHint = `${msg.video.id}_${msg.video.startSec}`;
    const media = {
      audio: msg.audioBase64 ? { base64: msg.audioBase64, filenameHint } : undefined,
      image: msg.imageBase64 ? { base64: msg.imageBase64, filenameHint } : undefined,
    };
    const result =
      msg.mode === 'basic'
        ? await createBasicNote(
            { frontHtml: escapeHtml(msg.front ?? ''), ...media, sentenceHtml, originHtml },
            { deckName: BASIC_DECK },
          )
        : await updateLastMiningNote(
            { ...media, sentenceHtml, originHtml },
            { noteTypes: NOTE_TYPES },
          );
    return { ok: true, word: result.word };
  } catch (e) {
    if (e instanceof AnkiError) return { ok: false, error: e.message };
    throw e;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

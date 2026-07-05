import { AnkiError, ankiAvailable, createBasicNote, updateLastMiningNote } from '../lib/anki';
import type { MineRequestMessage, MineResponse } from '../lib/messages';
import { getSettings } from '../lib/settings';

// AnkiConnect calls must originate from the extension origin — content-script
// fetches carry the page origin, which AnkiConnect rejects.

type BgMessage =
  | MineRequestMessage
  | { type: 'm2-anki-check' }
  | { type: 'm2-record-start' }
  | { type: 'm2-record-stop' }
  | { type: 'm2-screenshot' };

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'mine-current-line' || tab?.id === undefined) return;
    void browser.tabs.sendMessage(tab.id, { type: 'm2-mine-current' }).catch(() => {});
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse: (res: unknown) => void) => {
      const msg = message as BgMessage;
      const respond = (p: Promise<unknown>): true => {
        void p
          .then(sendResponse)
          .catch((e) =>
            sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
          );
        return true; // keep the message channel open for the async response
      };
      switch (msg?.type) {
        case 'm2-anki-check':
          return respond(handleAnkiCheck());
        case 'm2-mine':
          return respond(handleMine(msg));
        case 'm2-record-start':
          return respond(handleRecordStart(sender.tab?.id));
        case 'm2-record-stop':
          return respond(sendToOffscreen({ type: 'stop' }));
        case 'm2-screenshot':
          return respond(handleScreenshot(sender.tab?.windowId));
        default:
          return undefined;
      }
    },
  );
});

// --- DRM-safe capture (Netflix): tabCapture audio + visible-tab screenshot ---

async function handleRecordStart(tabId: number | undefined): Promise<unknown> {
  if (tabId === undefined) return { ok: false, error: 'No tab id' };
  // The offscreen document must exist BEFORE the stream id is minted — ids
  // are single-use and expire within seconds.
  await ensureOffscreenDocument();
  const streamId = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Tab capture timed out — press Alt+M once on this tab to grant capture access, then retry.')),
      5000,
    );
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError || !id) {
        const raw = chrome.runtime.lastError?.message ?? 'Tab capture refused.';
        const hint = raw.includes('invoked')
          ? 'Press Alt+M once on this tab (or click the migaku2 toolbar icon) to grant capture access, then retry.'
          : raw;
        reject(new Error(hint));
      } else {
        resolve(id);
      }
    });
  });
  return await sendToOffscreen({ type: 'start', streamId });
}

async function sendToOffscreen(msg: { type: string; streamId?: string }): Promise<unknown> {
  return await browser.runtime.sendMessage({ ...msg, target: 'm2-offscreen' });
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Record tab audio for Anki sentence-audio clips',
  });
}

async function handleScreenshot(windowId: number | undefined): Promise<unknown> {
  const dataUrl = await browser.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, {
    format: 'jpeg',
    quality: 92,
  });
  return { ok: true, dataUrl };
}

async function handleAnkiCheck(): Promise<MineResponse> {
  const settings = await getSettings();
  if (await ankiAvailable(settings.ankiUrl)) return { ok: true, word: '' };
  return {
    ok: false,
    error:
      `Can't reach Anki at ${settings.ankiUrl}. ` +
      'Open Anki (with the AnkiConnect add-on, code 2055492159) and try again.',
  };
}

async function handleMine(msg: MineRequestMessage): Promise<MineResponse> {
  try {
    const settings = await getSettings();
    const sentenceHtml = msg.lines.map(escapeHtml).join('<br>');
    const originHtml =
      `<a href="${escapeHtml(msg.video.url)}">${escapeHtml(msg.video.title || msg.video.id)}</a>` +
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
            {
              deckName: settings.basicDeck,
              modelName: settings.basicModel,
              ankiUrl: settings.ankiUrl,
            },
          )
        : await updateLastMiningNote(
            { ...media, sentenceHtml, originHtml },
            { noteTypes: settings.noteTypes, ankiUrl: settings.ankiUrl },
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

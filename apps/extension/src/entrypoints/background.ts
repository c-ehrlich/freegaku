import {
  AnkiError,
  ankiAvailable,
  checkLastMiningNote,
  createBasicNote,
  TargetWordMismatchError,
  updateLastMiningNote,
} from '../lib/anki';
import {
  isM24989MinePayload,
  isM2EmbedRequest,
  type M24989RuntimeMineRequest,
  type M24989RuntimeStatus,
  type M2TargetCheckRequest,
  type M2EmbedCaptureRequest,
  type M2EmbedCaptureResponse,
  type M2EmbedResponse,
  type MineRequestMessage,
  type MineResponse,
  type TargetCheckResponse,
  type M2YouglishEmbedRequest,
} from '../lib/messages';
import { getSettings } from '../lib/settings';

// AnkiConnect calls must originate from the extension origin — content-script
// fetches carry the page origin, which AnkiConnect rejects.

type BgMessage =
  | MineRequestMessage
  | M24989RuntimeMineRequest
  | M2TargetCheckRequest
  | M2YouglishEmbedRequest
  | { type: 'm2-anki-check' }
  | { type: 'm2-record-start' }
  | { type: 'm2-record-stop' }
  | { type: 'm2-screenshot' }
  | { type: 'm2-transcribe'; wavBase64: string; offsetMs: number; scale: number };

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command, tab) => {
    if (tab?.id === undefined) return;
    const type =
      command === 'toggle-sidebar'
        ? 'm2-toggle-sidebar'
        : command === 'mine-current-line'
          ? 'm2-mine-current'
          : null;
    if (type) void browser.tabs.sendMessage(tab.id, { type }, { frameId: 0 }).catch(() => {});
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
        case 'm2-4989-mine':
          return respond(handle4989Mine(msg, sender.tab?.id, sender.frameId, sender.url));
        case 'm2-target-check':
          return respond(handleTargetCheck(msg));
        case 'm2-youglish-embed':
          return respond(
            handleYouglishEmbed(msg, sender.tab?.id, sender.frameId, sender.url),
          );
        case 'm2-record-start':
          return respond(handleRecordStart(sender.tab?.id));
        case 'm2-record-stop':
          return respond(sendToOffscreen({ type: 'stop' }));
        case 'm2-screenshot':
          return respond(handleScreenshot(sender.tab?.windowId));
        case 'm2-transcribe':
          return respond(handleTranscribe(msg));
        default:
          return undefined;
      }
    },
  );
});

const ALLOWED_4989_ORIGINS = new Set([
  'https://4989.c-ehrlich.dev',
  'http://127.0.0.1:4989',
  'http://localhost:4989',
]);

const ALLOWED_YOUGLISH_ORIGINS = new Set([
  'https://youglish.com',
  'https://www.youglish.com',
]);

async function handleYouglishEmbed(
  msg: M2YouglishEmbedRequest,
  tabId: number | undefined,
  frameId: number | undefined,
  senderUrl: string | undefined,
): Promise<M2EmbedResponse> {
  if (
    tabId === undefined ||
    frameId !== 0 ||
    !senderUrl ||
    !ALLOWED_YOUGLISH_ORIGINS.has(new URL(senderUrl).origin) ||
    !isM2EmbedRequest(msg.request)
  ) {
    return { ok: false, error: 'Invalid YouGlish player request.' };
  }
  try {
    return (await browser.tabs.sendMessage(tabId, msg.request)) as M2EmbedResponse;
  } catch {
    return {
      ok: false,
      error: 'Freegaku could not reach the embedded YouTube player. Reload the YouGlish page.',
    };
  }
}

async function handle4989Mine(
  msg: M24989RuntimeMineRequest,
  tabId: number | undefined,
  frameId: number | undefined,
  senderUrl: string | undefined,
): Promise<MineResponse> {
  if (
    tabId === undefined ||
    frameId !== 0 ||
    !senderUrl ||
    !ALLOWED_4989_ORIGINS.has(new URL(senderUrl).origin) ||
    !isM24989MinePayload(msg.payload)
  ) {
    return { ok: false, error: 'Invalid 4989 mining request.' };
  }

  const anki = await handleAnkiCheck();
  if (!anki.ok) return anki;

  const settings = await getSettings();
  let targetOverride = msg.payload.targetOverride;
  if (msg.payload.mode === 'update') {
    const target = await targetCheck(
      msg.payload.lines,
      settings.mappings,
      settings.ankiUrl,
      targetOverride,
    );
    if (!target.ok) return target;
    targetOverride = target.target;
  }

  await send4989Status(tabId, msg.requestId, 'capturing');
  const captureRequest: M2EmbedCaptureRequest = {
    type: 'm2-embed-capture',
    capture: msg.payload.capture,
  };
  let capture: M2EmbedCaptureResponse;
  try {
    capture = (await browser.tabs.sendMessage(tabId, captureRequest)) as M2EmbedCaptureResponse;
  } catch {
    return {
      ok: false,
      error:
        'Freegaku could not reach the embedded YouTube player. Reload this 4989 page after installing or updating the extension.',
    };
  }
  if (!capture?.ok) {
    return { ok: false, error: capture?.error ?? 'The YouTube clip could not be captured.' };
  }

  await send4989Status(tabId, msg.requestId, 'updating-anki');
  const mineRequest: MineRequestMessage = {
    type: 'm2-mine',
    mode: msg.payload.mode,
    front: msg.payload.front,
    audioBase64: capture.audioBase64,
    imageBase64: capture.imageBase64,
    lines: msg.payload.lines,
    targetOverride,
    video: msg.payload.video,
  };
  return await handleMine(mineRequest);
}

async function handleTargetCheck(msg: M2TargetCheckRequest): Promise<TargetCheckResponse> {
  if (msg.mode === 'basic') return { ok: true, target: { noteId: 0, word: '' } };
  if (!Array.isArray(msg.lines) || msg.lines.length === 0) {
    return { ok: false, error: 'No sentence was selected.' };
  }
  const settings = await getSettings();
  return await targetCheck(msg.lines, settings.mappings, settings.ankiUrl, msg.targetOverride);
}

async function targetCheck(
  lines: string[],
  mappings: Awaited<ReturnType<typeof getSettings>>['mappings'],
  ankiUrl: string,
  targetOverride?: MineRequestMessage['targetOverride'],
): Promise<TargetCheckResponse> {
  try {
    const target = await checkLastMiningNote(lines.join('\n'), { mappings, ankiUrl, targetOverride });
    return { ok: true, target };
  } catch (e) {
    if (e instanceof TargetWordMismatchError) {
      return { ok: false, code: 'target-word-mismatch', error: e.message, target: e.target };
    }
    if (e instanceof AnkiError) return { ok: false, error: e.message };
    throw e;
  }
}

async function send4989Status(
  tabId: number,
  requestId: string,
  phase: M24989RuntimeStatus['phase'],
): Promise<void> {
  const status: M24989RuntimeStatus = { type: 'm2-4989-status', requestId, phase };
  await browser.tabs.sendMessage(tabId, status, { frameId: 0 }).catch(() => {});
}

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
          ? 'Press Alt+M once on this tab (or click the Freegaku toolbar icon) to grant capture access, then retry.'
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

/** Relay a WAV chunk to the transcription worker (content scripts can't call
 * localhost with the page's origin; the extension origin can). */
async function handleTranscribe(msg: {
  wavBase64: string;
  offsetMs: number;
  scale: number;
}): Promise<unknown> {
  const settings = await getSettings();
  const binary = atob(msg.wavBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = new URL('/transcribe', settings.workerUrl);
  url.searchParams.set('offsetMs', String(msg.offsetMs));
  url.searchParams.set('scale', String(msg.scale));
  if (settings.whisperLang) url.searchParams.set('lang', settings.whisperLang);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      body: bytes,
      headers: settings.workerToken
        ? { Authorization: `Bearer ${settings.workerToken}` }
        : undefined,
    });
  } catch {
    return {
      ok: false,
      error: `Can't reach the transcription worker at ${settings.workerUrl} — run \`pnpm --filter @migaku2/worker dev\`.`,
    };
  }
  const data = (await res.json()) as { segments?: unknown; error?: string };
  if (!res.ok || data.error) return { ok: false, error: data.error ?? `Worker HTTP ${res.status}` };
  return { ok: true, segments: data.segments };
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
            { ...media, sentenceHtml, sentenceText: msg.lines.join('\n'), originHtml },
            {
              mappings: settings.mappings,
              ankiUrl: settings.ankiUrl,
              targetOverride: msg.targetOverride,
            },
          );
    return { ok: true, word: result.word };
  } catch (e) {
    if (e instanceof TargetWordMismatchError) {
      return { ok: false, code: 'target-word-mismatch', error: e.message, target: e.target };
    }
    if (e instanceof AnkiError) return { ok: false, error: e.message };
    throw e;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

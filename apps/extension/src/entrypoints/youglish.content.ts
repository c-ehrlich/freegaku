import type { SubtitleCue } from '@migaku2/subtitles';
import type { CaptureDraft } from '../lib/capture-editor';
import { captureTimingForSelection } from '../lib/capture-timing';
import {
  M2_SOURCE,
  isM2Message,
  isYouglishResultPayload,
} from '../lib/messages';
import type {
  M2EmbedRequest,
  M2EmbedResponse,
  M2EmbedState,
  M2YouglishEmbedRequest,
  MineRequestMessage,
  MineResponse,
  TargetCheckResponse,
  TargetOverride,
  YouglishResultPayload,
} from '../lib/messages';
import { promptFront } from '../lib/prompt';
import { getSettings, onSettingsChanged } from '../lib/settings';
import type { M2Settings } from '../lib/settings';
import { Sidebar } from '../lib/sidebar';
import type { SidebarMineRequest } from '../lib/sidebar';
import { showToast } from '../lib/toast';

const MATCHES = ['https://youglish.com/*', 'https://www.youglish.com/*'];
const STORAGE_SIDEBAR_VISIBLE = 'sidebarVisible';
const MOUNT_CHECK_INTERVAL_MS = 1000;
const TICK_MS = 250;

export default defineContentScript({
  matches: MATCHES,
  runAt: 'document_idle',
  async main() {
    const sidebar = new Sidebar();
    sidebar.host.classList.add('m2-floating', 'm2-youglish');
    sidebar.setGenerateAvailable(false);
    sidebar.setTracks([], 0);

    let currentResult: YouglishResultPayload | null = null;
    let cues: SubtitleCue[] = [];
    let currentTranscriptKey = '';
    let fullTranscriptVideoId: string | null = null;
    let mining = false;
    let previewSession: EmbedPlaybackPreviewSession | null = null;
    let settings: M2Settings = await getSettings();
    let tickPending = false;
    let wasPaused = true;
    onSettingsChanged((next) => (settings = next));

    const stored = await browser.storage.local.get(STORAGE_SIDEBAR_VISIBLE);
    let sidebarVisible = (stored[STORAGE_SIDEBAR_VISIBLE] as boolean | undefined) ?? true;
    sidebar.setVisible(sidebarVisible);

    sidebar.onSeek = (ms) => {
      controlYouglish('seek', ms);
      controlYouglish('play');
    };
    sidebar.onRetry = () => {
      requestResult();
      void tick();
    };
    sidebar.onMine = (request) => {
      if (request.adjust) void openCaptureEditor(request);
      else void mine(request);
    };

    function ensureMounted(): void {
      if (!document.body) return;
      if (sidebar.host.parentElement !== document.body) document.body.append(sidebar.host);
    }

    function onResult(payload: YouglishResultPayload): void {
      const videoChanged = payload.videoId !== currentResult?.videoId;
      const nextCues = payload.cues.map((cue) => ({
        start: cue.startMs,
        end: cue.endMs,
        text: cue.text,
      }));
      currentResult = payload;
      ensureMounted();
      if (videoChanged) {
        fullTranscriptVideoId = null;
        previewSession?.abandon();
        previewSession = null;
        sidebar.closeCaptureEditor();
      }
      const payloadIsFullTranscript = payload.cues.length > 1;
      if (payloadIsFullTranscript || fullTranscriptVideoId !== payload.videoId) {
        applyTranscript(payload.videoId, nextCues, payloadIsFullTranscript);
      }
      sidebar.updateTime(payload.startMs, false);
      if (videoChanged) sidebar.setStatus('Connecting to the YouGlish player…');
      void tick();
      if (videoChanged) void loadYouTubeTranscript(payload.videoId);
    }

    function applyTranscript(videoId: string, nextCues: SubtitleCue[], full: boolean): void {
      if (currentResult?.videoId !== videoId || nextCues.length === 0) return;
      const nextTranscriptKey = transcriptKey(videoId, nextCues);
      if (nextTranscriptKey === currentTranscriptKey) {
        if (full) fullTranscriptVideoId = videoId;
        return;
      }
      previewSession?.abandon();
      previewSession = null;
      sidebar.closeCaptureEditor();
      cues = nextCues;
      currentTranscriptKey = nextTranscriptKey;
      if (full) fullTranscriptVideoId = videoId;
      sidebar.setCues(cues);
      sidebar.updateTime(currentResult.startMs, false);
      if (full) sidebar.recenter();
    }

    async function loadYouTubeTranscript(videoId: string): Promise<void> {
      const response = await sendEmbed({
        type: 'm2-embed-transcript',
        videoId,
        languageCode: 'ja',
      }).catch(() => null);
      if (currentResult?.videoId !== videoId) return;
      if (
        response?.ok &&
        'cues' in response &&
        response.videoId === videoId &&
        response.cues.length > 0
      ) {
        applyTranscript(
          videoId,
          response.cues.map((cue) => ({
            start: cue.startMs,
            end: cue.endMs,
            text: cue.text,
          })),
          true,
        );
        return;
      }
      window.postMessage(
        { source: M2_SOURCE, type: 'youglish-transcript-fallback', videoId },
        '*',
      );
    }

    async function openCaptureEditor(request: SidebarMineRequest): Promise<void> {
      const result = currentResult;
      if (!result || previewSession) return;
      const span = cues.slice(request.from, request.to + 1);
      const timing = captureTimingForSelection(
        span,
        { startOffset: request.startOffset, endOffset: request.endOffset },
      );
      if (!timing) return;
      try {
        const state = await getEmbedState();
        if (state.videoId !== result.videoId) {
          showToast('The YouGlish clip is still loading. Try again in a moment.', 'error');
          return;
        }
        const session = new EmbedPlaybackPreviewSession(
          state,
          getEmbedState,
          controlYouglish,
        );
        previewSession = session;
        sidebar.showCaptureEditor({
          ...timing,
          selectedLineCount: span.length,
          onFrameChange: (timeMs) => session.showFrame(timeMs),
          onPreviewAudio: (draft) => session.playRange(draft.startMs, draft.endMs, draft.imageMs),
          onConfirm: async (draft) => {
            const attempted = await mine(request, draft);
            if (!attempted) return false;
            if (previewSession === session) previewSession = null;
            await session.restore();
            return true;
          },
          onCancel: () => {
            if (previewSession === session) previewSession = null;
            void session.restore().catch(showEmbedError);
          },
        });
      } catch (error) {
        showEmbedError(error);
      }
    }

    async function mine(request: SidebarMineRequest, adjusted?: CaptureDraft): Promise<boolean> {
      const result = currentResult;
      if (!result) return false;
      const span = cues.slice(request.from, request.to + 1);
      if (span.length === 0) return false;
      if (mining) {
        showToast('Already capturing — wait for the current card.', 'error');
        return false;
      }
      const state = await getEmbedState().catch(() => null);
      if (!state || state.videoId !== result.videoId) {
        showToast('The YouGlish clip is still loading. Try again in a moment.', 'error');
        return false;
      }
      const ping = (await browser.runtime.sendMessage({ type: 'm2-anki-check' })) as MineResponse;
      if (!ping.ok) {
        showToast(ping.error, 'error');
        return false;
      }
      let front: string | null = null;
      if (request.mode === 'basic') {
        front = await promptFront(request.selText || result.query);
        if (!front) return false;
      }
      let targetOverride: TargetOverride | undefined;
      if (request.mode === 'update') {
        const check = (await browser.runtime.sendMessage({
          type: 'm2-target-check',
          mode: 'update',
          lines: span.map((cue) => cue.text),
        })) as TargetCheckResponse;
        if (!check.ok) {
          if ('code' in check && check.code === 'target-word-mismatch') {
            const confirmed = window.confirm(
              `The selected sentence does not contain “${check.target.word}”.\n\n` +
                `Update the card for “${check.target.word}” anyway?`,
            );
            if (!confirmed) return false;
            targetOverride = check.target;
          } else {
            showToast(check.error, 'error');
            return false;
          }
        } else {
          targetOverride = check.target;
        }
      }

      mining = true;
      sidebar.setRowBusy(request.from, request.to, true);
      try {
        const startMs = adjusted?.startMs ?? span[0]!.start;
        const endMs = adjusted?.endMs ?? span.at(-1)!.end;
        const imageMs = adjusted?.imageMs ?? startMs + (endMs - startMs) / 2;
        const capture = await sendEmbed({
          type: 'm2-embed-capture',
          capture: { startMs, endMs, imageMs },
          options: {
            padStartMs: adjusted ? 0 : settings.padStartMs,
            padEndMs: adjusted ? 0 : settings.padEndMs,
            imageMaxWidth: settings.imageMaxWidth,
            jpegQuality: settings.jpegQuality,
          },
        });
        if (!capture.ok || !('audioBase64' in capture)) {
          throw new Error(capture.ok ? 'The YouTube clip could not be captured.' : capture.error);
        }
        if (capture.videoId !== result.videoId || currentResult?.videoId !== result.videoId) {
          throw new Error('The YouGlish video changed during capture. Try the new clip again.');
        }
        const message: MineRequestMessage = {
          type: 'm2-mine',
          mode: request.mode,
          front: front ?? undefined,
          audioBase64: capture.audioBase64,
          imageBase64: capture.imageBase64,
          lines: span.map((cue) => cue.text),
          targetOverride,
          video: {
            id: result.videoId,
            title: result.title || `YouGlish: ${result.query}`,
            author: 'YouGlish',
            startSec: Math.floor(startMs / 1000),
            url: `https://youtu.be/${result.videoId}?t=${Math.floor(startMs / 1000)}`,
          },
        };
        const response = (await browser.runtime.sendMessage(message)) as MineResponse;
        if (response.ok) {
          showToast(
            request.mode === 'basic'
              ? `Created Basic card “${front}” ✓`
              : response.word
                ? `Added to 「${response.word}」 ✓`
                : 'Card updated ✓',
          );
        } else {
          showToast(response.error, 'error');
        }
      } catch (error) {
        showEmbedError(error);
      } finally {
        mining = false;
        sidebar.setRowBusy(request.from, request.to, false);
      }
      return true;
    }

    async function tick(): Promise<void> {
      if (tickPending || !currentResult) return;
      tickPending = true;
      try {
        const state = await getEmbedState();
        const ready = state.videoId === currentResult.videoId;
        sidebar.setStatus(ready ? null : 'Loading the selected YouGlish clip…');
        if (ready && sidebarVisible) {
          const playing = !state.paused;
          sidebar.updateTime(state.currentTimeMs, playing);
          if (playing && wasPaused) sidebar.recenter();
          wasPaused = state.paused;
        }
      } catch (error) {
        sidebar.setStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        tickPending = false;
      }
    }

    function toggleSidebar(): void {
      sidebarVisible = !sidebarVisible;
      sidebar.setVisible(sidebarVisible);
      ensureMounted();
      void browser.storage.local.set({ [STORAGE_SIDEBAR_VISIBLE]: sidebarVisible });
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window || !isM2Message(event.data)) return;
      if (
        event.data.type === 'youglish-result' &&
        isYouglishResultPayload(event.data.payload)
      ) {
        onResult(event.data.payload);
      }
    });

    browser.runtime.onMessage.addListener((message: { type?: string }) => {
      if (message?.type === 'm2-toggle-sidebar') {
        toggleSidebar();
      } else if (message?.type === 'm2-mine-current' && currentResult) {
        const active = activeCueForResult(sidebar.activeCueIndex, cues, currentResult);
        if (active >= 0) {
          void mine({ from: active, to: active, mode: 'update', selText: '', adjust: false });
        }
      }
    });

    function requestResult(): void {
      window.postMessage({ source: M2_SOURCE, type: 'refresh' }, '*');
    }

    ensureMounted();
    sidebar.setStatus('Waiting for a YouGlish result…');
    requestResult();
    setInterval(ensureMounted, MOUNT_CHECK_INTERVAL_MS);
    setInterval(() => void tick(), TICK_MS);
  },
});

async function sendEmbed(request: M2EmbedRequest): Promise<M2EmbedResponse> {
  const message: M2YouglishEmbedRequest = { type: 'm2-youglish-embed', request };
  const response = (await browser.runtime.sendMessage(message)) as M2EmbedResponse | undefined;
  if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    return { ok: false, error: 'The embedded YouTube player did not respond.' };
  }
  return response;
}

async function getEmbedState(): Promise<M2EmbedState> {
  const response = await sendEmbed({ type: 'm2-embed-state' });
  if (!response.ok) throw new Error(response.error);
  if (!('state' in response)) throw new Error('The embedded YouTube player returned no state.');
  return response.state;
}

function controlYouglish(
  action: 'seek' | 'play' | 'pause',
  ms?: number,
): void {
  window.postMessage({ source: M2_SOURCE, type: 'control', action, ms }, '*');
}

class EmbedPlaybackPreviewSession {
  private generation = 0;
  private active = true;

  constructor(
    private readonly original: M2EmbedState,
    private readonly readState: () => Promise<M2EmbedState>,
    private readonly sendControl: (action: 'seek' | 'play' | 'pause', ms?: number) => void,
  ) {}

  showFrame(timeMs: number): void {
    const generation = ++this.generation;
    void this.pauseAndSeek(timeMs, generation).catch(showEmbedError);
  }

  async playRange(startMs: number, endMs: number, returnMs: number): Promise<void> {
    const generation = ++this.generation;
    await this.pauseAndSeek(startMs, generation);
    await this.waitForSeek(startMs, generation);
    if (!this.current(generation)) return;
    await this.control('play');
    while (this.current(generation)) {
      const state = await this.state();
      if (state.currentTimeMs >= endMs) break;
      await sleep(50);
    }
    if (!this.current(generation)) return;
    await this.control('pause');
    await this.control('seek', returnMs);
  }

  async restore(): Promise<void> {
    if (!this.active) return;
    const generation = ++this.generation;
    await this.pauseAndSeek(this.original.currentTimeMs, generation);
    await this.waitForSeek(this.original.currentTimeMs, generation);
    if (this.current(generation) && !this.original.paused) await this.control('play');
    this.active = false;
  }

  abandon(): void {
    this.active = false;
    this.generation++;
  }

  private async pauseAndSeek(timeMs: number, generation: number): Promise<void> {
    await this.control('pause');
    if (!this.current(generation)) return;
    await this.control('seek', timeMs);
  }

  private async waitForSeek(targetMs: number, generation: number): Promise<void> {
    const deadline = performance.now() + 6000;
    while (this.current(generation) && performance.now() < deadline) {
      const state = await this.state();
      if (Math.abs(state.currentTimeMs - targetMs) <= 150) return;
      await sleep(50);
    }
  }

  private async control(action: 'seek' | 'play' | 'pause', ms?: number): Promise<M2EmbedState> {
    this.sendControl(action, ms);
    await sleep(50);
    return this.state();
  }

  private async state(): Promise<M2EmbedState> {
    return this.readState();
  }

  private current(generation: number): boolean {
    return this.active && generation === this.generation;
  }
}

function transcriptKey(videoId: string, cues: SubtitleCue[]): string {
  return `${videoId}:${cues.map((cue) => `${cue.start}:${cue.end}:${cue.text}`).join('|')}`;
}

function activeCueForResult(
  highlighted: number,
  cues: SubtitleCue[],
  result: YouglishResultPayload,
): number {
  if (highlighted >= 0 && highlighted < cues.length) return highlighted;
  const containing = cues.findIndex(
    (cue) => cue.start <= result.startMs && cue.end >= result.startMs,
  );
  if (containing >= 0) return containing;
  return cues.reduce(
    (closest, cue, index) =>
      closest < 0 || Math.abs(cue.start - result.startMs) < Math.abs(cues[closest]!.start - result.startMs)
        ? index
        : closest,
    -1,
  );
}

function showEmbedError(error: unknown): void {
  showToast(error instanceof Error ? error.message : String(error), 'error');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

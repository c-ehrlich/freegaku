import { parseSrv3 } from '@migaku2/subtitles';
import type { SubtitleCue } from '@migaku2/subtitles';
import { M2_SOURCE, isM2Message } from '../lib/messages';
import type { MineRequestMessage, MineResponse, VideoTracksPayload } from '../lib/messages';
import { blobToBase64 } from '../lib/blob';
import type { CaptureDraft } from '../lib/capture-editor';
import { captureTimingForSelection } from '../lib/capture-timing';
import { captureSpan } from '../lib/capture';
import { GenerationSession, elementChunkRecorder, loadGenCues, saveGenCues } from '../lib/generate';
import type { Segment } from '../lib/generate';
import { webmOpusToMp3 } from '../lib/mp3';
import { Overlay } from '../lib/overlay';
import { PlaybackPreviewSession } from '../lib/playback-preview';
import { promptFront } from '../lib/prompt';
import { getSettings, onSettingsChanged } from '../lib/settings';
import type { M2Settings } from '../lib/settings';
import { Sidebar } from '../lib/sidebar';
import type { SidebarMineRequest } from '../lib/sidebar';
import { showToast } from '../lib/toast';

const STORAGE_SIDEBAR_VISIBLE = 'sidebarVisible';
const STORAGE_OVERLAY_VISIBLE = 'overlayVisible';
const MOUNT_CHECK_INTERVAL_MS = 1000;
const TICK_MS = 250;

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
  runAt: 'document_idle',
  async main() {
    console.debug('[m2] isolated script loaded', location.href);
    const sidebar = new Sidebar();
    const overlay = new Overlay();
    let payload: VideoTracksPayload | null = null;
    let cues: SubtitleCue[] = [];
    let trackIndex = -1;
    let video: HTMLVideoElement | null = null;
    let fallbackRequestedFor: string | null = null;
    let mining = false;
    let wasPaused = true;
    let gen: GenerationSession | null = null;
    let genCues: SubtitleCue[] = [];
    let genSelected = false;
    let previewSession: PlaybackPreviewSession | null = null;
    let settings: M2Settings = await getSettings();
    onSettingsChanged((s) => (settings = s));

    const stored = await browser.storage.local.get([
      STORAGE_SIDEBAR_VISIBLE,
      STORAGE_OVERLAY_VISIBLE,
    ]);
    let sidebarVisible = (stored[STORAGE_SIDEBAR_VISIBLE] as boolean | undefined) ?? true;
    let overlayVisible = (stored[STORAGE_OVERLAY_VISIBLE] as boolean | undefined) ?? true;
    sidebar.setVisible(sidebarVisible);
    overlay.setEnabled(overlayVisible);

    sidebar.onSeek = (ms) => {
      if (video) {
        video.currentTime = ms / 1000;
        void video.play().catch(() => {});
      }
    };
    sidebar.onTrackChange = (i) => {
      if (payload && genAvailable() && i === payload.tracks.length) selectGenTrack();
      else void loadTrack(i);
    };
    sidebar.onRetry = () => {
      if (trackIndex >= 0) void loadTrack(trackIndex);
      else requestTracks();
    };
    sidebar.onMine = (request) => {
      if (request.adjust) openCaptureEditor(request);
      else void mine(request);
    };
    sidebar.onGenerate = () => {
      if (gen) gen.stop();
      else void startGeneration();
    };

    // --- Whisper generation ------------------------------------------------

    function genAvailable(): boolean {
      return genCues.length > 0 || gen !== null;
    }

    function displayTracks() {
      const tracks = [...(payload?.tracks ?? [])];
      if (genAvailable()) {
        tracks.push({ url: '', languageCode: '', kind: '' as const, label: '✨ Whisper (generated)' });
      }
      return tracks;
    }

    function refreshTrackSelect(): void {
      const tracks = displayTracks();
      sidebar.setTracks(tracks, genSelected ? tracks.length - 1 : Math.max(trackIndex, 0));
    }

    function selectGenTrack(): void {
      genSelected = true;
      cues = genCues;
      sidebar.setStatus(gen ? 'Generating…' : null);
      sidebar.setCues(genCues);
      refreshTrackSelect();
    }

    async function startGeneration(): Promise<void> {
      if (!payload?.videoId || !video) return;
      const forVideo = payload.videoId;
      const v = video;
      const prev = { rate: v.playbackRate, muted: v.muted };
      const rate = Math.max(1, Math.min(3, settings.generateRate));
      if (rate > 1) {
        v.playbackRate = rate;
        v.muted = true; // fast mode: silent; captureStream records regardless
      }
      if (v.paused) void v.play().catch(() => {});
      sidebar.setGenerating(true);
      genCues = [];
      gen = new GenerationSession({
        video: v,
        makeRecorder: () => elementChunkRecorder(v),
        chunkSec: 30,
        transcribe: transcribeChunk,
        onCues: (c) => {
          if (payload?.videoId !== forVideo) return;
          genCues = c;
          if (genSelected) {
            cues = c;
            sidebar.setCues(c);
          }
          void saveGenCues('youtube', forVideo, c);
        },
        onStatus: (s) => {
          if (genSelected) sidebar.setStatus(s);
        },
      });
      selectGenTrack(); // after gen is set, so the pseudo-track exists
      try {
        await gen.run();
        if (genCues.length > 0) showToast(`Whisper subtitles ready — ${genCues.length} lines`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        gen = null;
        sidebar.setGenerating(false);
        v.playbackRate = prev.rate;
        v.muted = prev.muted;
        refreshTrackSelect();
      }
    }

    async function transcribeChunk(wav: Blob, offsetMs: number, scale: number): Promise<Segment[]> {
      const res = (await browser.runtime.sendMessage({
        type: 'm2-transcribe',
        wavBase64: await blobToBase64(wav),
        offsetMs,
        scale,
      })) as { ok: boolean; segments?: Segment[]; error?: string };
      if (!res.ok || !res.segments) throw new Error(res.error ?? 'Transcription failed');
      return res.segments;
    }

    function requestTracks(): void {
      window.postMessage({ source: M2_SOURCE, type: 'refresh' }, '*');
    }

    function pickDefaultTrack(p: VideoTracksPayload): number {
      const score = (i: number): number => {
        const t = p.tracks[i]!;
        const ja = t.languageCode.startsWith('ja');
        if (ja && t.kind !== 'asr') return 0;
        if (ja) return 1;
        if (t.kind !== 'asr') return 2;
        return 3;
      };
      let best = -1;
      for (let i = 0; i < p.tracks.length; i++) {
        if (best === -1 || score(i) < score(best)) best = i;
      }
      return best;
    }

    async function loadTrack(index: number): Promise<void> {
      if (!payload) return;
      const track = payload.tracks[index];
      if (!track) return;
      trackIndex = index;
      genSelected = false;
      refreshTrackSelect();
      cues = [];
      sidebar.setCues([]);
      overlay.setText(null);
      sidebar.setStatus('Loading subtitles…');
      const forVideo = payload.videoId;
      try {
        const url = new URL(track.url, location.origin);
        url.searchParams.set('fmt', 'srv3');
        if (payload.source === 'player' && payload.clientName) {
          url.searchParams.set('c', payload.clientName);
          if (payload.clientVersion) url.searchParams.set('cver', payload.clientVersion);
        }
        const res = await fetch(url.toString());
        const xml = await res.text();
        console.debug('[m2] track response:', res.status, `${xml.length} bytes`);
        if (payload?.videoId !== forVideo || trackIndex !== index) return; // stale
        if (!res.ok || xml.length === 0) {
          // Empty 200 = missing/invalid POT on the player-sourced URL. Ask the
          // MAIN world for InnerTube (ANDROID) tracks, whose URLs need no POT.
          if (payload.source === 'player' && fallbackRequestedFor !== forVideo) {
            fallbackRequestedFor = forVideo;
            console.debug('[m2] player track empty; requesting InnerTube fallback');
            sidebar.setStatus('Retrying via fallback…');
            window.postMessage({ source: M2_SOURCE, type: 'fallback', videoId: forVideo }, '*');
          } else {
            sidebar.setStatus('Subtitles came back empty (YouTube token issue).', true);
          }
          return;
        }
        const parsed = parseSrv3(xml);
        if (parsed.length === 0) {
          sidebar.setStatus('Track contained no usable lines.', true);
          return;
        }
        cues = parsed;
        sidebar.setStatus(null);
        sidebar.setCues(parsed);
      } catch {
        if (payload?.videoId === forVideo && trackIndex === index) {
          sidebar.setStatus('Failed to load subtitles.', true);
        }
      }
    }

    function onTracksPayload(p: VideoTracksPayload): void {
      console.debug('[m2] tracks payload', p.videoId, p.source, p.tracks.length);
      const isNewVideo = p.videoId !== payload?.videoId;
      payload = p;
      if (p.videoId === null) {
        sidebar.host.remove();
        overlay.setText(null);
        return;
      }
      if (isNewVideo) {
        fallbackRequestedFor = null;
        cues = [];
        overlay.setText(null);
        gen?.stop();
        genCues = [];
        genSelected = false;
        // Surface a previously generated track for this video, if cached.
        const forVideo = p.videoId;
        void loadGenCues('youtube', forVideo).then((cached) => {
          if (cached && payload?.videoId === forVideo && !gen) {
            genCues = cached;
            refreshTrackSelect();
            if (payload.tracks.length === 0) selectGenTrack();
          }
        });
      }
      ensureMounted();
      if (p.tracks.length === 0) {
        trackIndex = -1;
        cues = [];
        refreshTrackSelect();
        sidebar.setCues([]);
        sidebar.setStatus(
          p.source === 'none'
            ? 'No subtitles found — click ✨ to generate with Whisper.'
            : 'No subtitle tracks.',
          true,
        );
        return;
      }
      if (isNewVideo || trackIndex < 0 || trackIndex >= p.tracks.length) {
        void loadTrack(pickDefaultTrack(p));
      } else {
        void loadTrack(trackIndex);
      }
    }

    function openCaptureEditor(request: SidebarMineRequest): void {
      if (!video || previewSession) return;
      const span = cues.slice(request.from, request.to + 1);
      const timing = captureTimingForSelection(
        span,
        { startOffset: request.startOffset, endOffset: request.endOffset },
      );
      if (!timing) return;

      const editorVideo = video;
      const session = new PlaybackPreviewSession({
        video: editorVideo,
        pause: () => editorVideo.pause(),
        play: () => {
          void editorVideo.play().catch(() => {});
        },
        seek: (timeMs) => {
          editorVideo.currentTime = timeMs / 1000;
        },
      });
      previewSession = session;
      overlay.setEnabled(false);
      sidebar.showCaptureEditor({
        ...timing,
        selectedLineCount: span.length,
        onFrameChange: (timeMs) => session.showFrame(timeMs),
        onPreviewAudio: (draft) =>
          session.playRange(draft.startMs, draft.endMs, draft.imageMs),
        onConfirm: async (draft) => {
          const attempted = await mine(request, draft);
          if (!attempted) return false;
          if (previewSession === session) previewSession = null;
          await session.restore();
          overlay.setEnabled(overlayVisible);
          return true;
        },
        onCancel: () => {
          if (previewSession === session) previewSession = null;
          void session.restore().finally(() => overlay.setEnabled(overlayVisible));
        },
      });
    }

    async function mine(
      request: SidebarMineRequest,
      adjusted?: CaptureDraft,
    ): Promise<boolean> {
      if (!payload?.videoId || !video) return false;
      const span = cues.slice(request.from, request.to + 1);
      if (span.length === 0) return false;
      if (mining) {
        showToast('Already capturing — wait for the current card.', 'error');
        return false;
      }
      // Fail fast while nothing has happened yet: an unreachable Anki should
      // not cost an audible replay.
      const ping = (await browser.runtime.sendMessage({ type: 'm2-anki-check' })) as MineResponse;
      if (!ping.ok) {
        showToast(ping.error, 'error');
        return false;
      }
      // Ask for the Front before the (audible) capture starts, so Escape
      // costs nothing.
      let front: string | null = null;
      if (request.mode === 'basic') {
        front = await promptFront(request.selText);
        if (!front) return false;
      }
      mining = true;
      sidebar.setRowBusy(request.from, request.to, true);
      try {
        const startMs = adjusted?.startMs ?? span[0]!.start;
        const endMs = adjusted?.endMs ?? span[span.length - 1]!.end;
        const { audioWebm, imageJpeg } = await captureSpan(video, startMs, endMs, {
          padStartMs: adjusted ? 0 : settings.padStartMs,
          padEndMs: adjusted ? 0 : settings.padEndMs,
          imageTimeMs: adjusted?.imageMs,
          imageMaxWidth: settings.imageMaxWidth,
          jpegQuality: settings.jpegQuality,
        });
        const mp3 = await webmOpusToMp3(audioWebm);
        const message: MineRequestMessage = {
          type: 'm2-mine',
          mode: request.mode,
          front: front ?? undefined,
          audioBase64: await blobToBase64(mp3),
          imageBase64: imageJpeg ? await blobToBase64(imageJpeg) : null,
          lines: span.map((c) => c.text),
          video: {
            id: payload.videoId,
            title: payload.title,
            author: payload.author,
            startSec: Math.floor(startMs / 1000),
            url: `https://youtu.be/${payload.videoId}?t=${Math.floor(startMs / 1000)}`,
          },
        };
        const res = (await browser.runtime.sendMessage(message)) as MineResponse;
        if (res.ok) {
          showToast(
            request.mode === 'basic'
              ? `Created Basic card “${front}” ✓`
              : res.word
                ? `Added to 「${res.word}」 ✓`
                : 'Card updated ✓',
          );
        } else {
          showToast(res.error, 'error');
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        mining = false;
        sidebar.setRowBusy(request.from, request.to, false);
      }
      return true;
    }

    function ensureMounted(): void {
      if (!payload?.videoId) return;
      if (!sidebar.host.isConnected) {
        // #secondary is the related-videos column on watch pages. Absent in
        // theater/fullscreen and on shorts — sidebar simply stays unmounted
        // there; the overlay covers those modes.
        const secondary = document.querySelector('#secondary');
        if (secondary) secondary.prepend(sidebar.host);
      }
      const player = document.querySelector<HTMLElement>('#movie_player');
      if (player) overlay.mount(player);
      const currentVideo = document.querySelector<HTMLVideoElement>('video.html5-main-video');
      if (currentVideo !== video) video = currentVideo;
    }

    /** Cue strictly containing t — the overlay mimics real captions. */
    function cueAt(tMs: number): SubtitleCue | null {
      for (const c of cues) {
        if (c.start > tMs) break;
        if (tMs < c.end) return c;
      }
      return null;
    }

    window.addEventListener('message', (e) => {
      if (e.source !== window || !isM2Message(e.data)) return;
      if (e.data.type === 'tracks') onTracksPayload(e.data.payload);
    });

    // Alt+M (extension command): mine the current line.
    browser.runtime.onMessage.addListener((msg: { type?: string }) => {
      if (msg?.type !== 'm2-mine-current') return;
      const i = sidebar.activeCueIndex;
      if (i >= 0) {
        void mine({ from: i, to: i, mode: 'update', selText: '', adjust: false });
      }
      else showToast('No active subtitle line to mine.', 'error');
    });

    window.addEventListener(
      'keydown',
      (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        const sidebarCode = `Key${settings.sidebarKey}`;
        const overlayCode = `Key${settings.overlayKey}`;
        if (e.code !== sidebarCode && e.code !== overlayCode) return;
        const target = e.target as HTMLElement | null;
        if (
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        if (e.code === sidebarCode) {
          sidebarVisible = !sidebarVisible;
          sidebar.setVisible(sidebarVisible);
          void browser.storage.local.set({ [STORAGE_SIDEBAR_VISIBLE]: sidebarVisible });
        } else {
          overlayVisible = !overlayVisible;
          overlay.setEnabled(overlayVisible);
          void browser.storage.local.set({ [STORAGE_OVERLAY_VISIBLE]: overlayVisible });
        }
      },
      true,
    );

    setInterval(ensureMounted, MOUNT_CHECK_INTERVAL_MS);
    // Poll instead of listening to timeupdate: immune to element swaps and
    // fires reliably after seeks-while-paused too.
    setInterval(() => {
      if (!video) return;
      const tMs = video.currentTime * 1000;
      const playing = !video.paused;
      if (sidebarVisible) {
        // Autoscroll (centered) only while playing; while paused the user may
        // be browsing the list — snap back to center on resume.
        sidebar.updateTime(tMs, playing);
        if (playing && wasPaused) sidebar.recenter();
      }
      wasPaused = !playing;
      overlay.setText(cueAt(tMs)?.text ?? null);
    }, TICK_MS);
    requestTracks();
  },
});

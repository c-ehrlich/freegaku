import { parseWebVtt } from '@migaku2/subtitles';
import type { SubtitleCue } from '@migaku2/subtitles';
import { M2_SOURCE, isM2Message } from '../lib/messages';
import type { MineMode, MineRequestMessage, MineResponse, VideoTracksPayload } from '../lib/messages';
import { blobToBase64 } from '../lib/blob';
import { captureNetflixSpan } from '../lib/capture-netflix';
import { GenerationSession, loadGenCues, saveGenCues, tabCaptureChunkRecorder } from '../lib/generate';
import type { Segment } from '../lib/generate';
import { webmOpusToMp3 } from '../lib/mp3';
import { Overlay } from '../lib/overlay';
import { promptFront } from '../lib/prompt';
import { getSettings, onSettingsChanged } from '../lib/settings';
import type { M2Settings } from '../lib/settings';
import { Sidebar } from '../lib/sidebar';
import { showToast } from '../lib/toast';

const STORAGE_SIDEBAR_VISIBLE = 'sidebarVisible';
const STORAGE_OVERLAY_VISIBLE = 'overlayVisible';
const MOUNT_CHECK_INTERVAL_MS = 1000;
const TICK_MS = 250;
const SIDEBAR_WIDTH_PX = 400;

// Netflix is always dark and the sidebar is a full-height right panel that
// reclaims space from the player (.watch-video--player-view is responsive
// and relayouts when narrowed — the Language Reactor / Jelly-Party recipe).
const NF_CSS = `
#m2-sidebar.m2-nf {
  position: absolute;
  top: 0;
  right: 0;
  width: ${SIDEBAR_WIDTH_PX}px;
  height: 100%;
  margin: 0;
  border-radius: 0;
  background: #141414;
  color: #f1f1f1;
  display: flex;
  flex-direction: column;
  z-index: 20;
}
#m2-sidebar.m2-nf .m2-list {
  max-height: none;
  flex: 1;
}
#m2-sidebar.m2-nf .m2-status {
  color: #aaa;
}
`;
const SHRINK_CSS = `
.watch-video--player-view {
  width: calc(100vw - ${SIDEBAR_WIDTH_PX}px) !important;
}
`;

export default defineContentScript({
  matches: ['*://www.netflix.com/*'],
  runAt: 'document_idle',
  async main() {
    console.debug('[m2:nf] isolated script loaded', location.href);
    const sidebar = new Sidebar();
    sidebar.host.classList.add('m2-nf');
    const nfStyle = document.createElement('style');
    nfStyle.textContent = NF_CSS;
    sidebar.host.append(nfStyle);
    // Keep Netflix's idle detection working while the mouse is on our panel,
    // so the player controls can fade out.
    sidebar.host.addEventListener('mousemove', (e) => e.stopPropagation());

    const shrinkStyle = document.createElement('style');
    shrinkStyle.id = 'm2-nf-shrink';
    shrinkStyle.textContent = SHRINK_CSS;

    const overlay = new Overlay();
    let payload: VideoTracksPayload | null = null;
    let cues: SubtitleCue[] = [];
    let trackIndex = -1;
    let video: HTMLVideoElement | null = null;
    let mining = false;
    let wasPaused = true;
    let gen: GenerationSession | null = null;
    let genCues: SubtitleCue[] = [];
    let genSelected = false;
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

    function control(action: 'seek' | 'play' | 'pause', ms?: number): void {
      window.postMessage({ source: M2_SOURCE, type: 'control', action, ms }, '*');
    }

    sidebar.onSeek = (ms) => {
      control('seek', ms);
      control('play');
    };
    sidebar.onTrackChange = (i) => {
      if (payload && genAvailable() && i === payload.tracks.length) selectGenTrack();
      else void loadTrack(i);
    };
    sidebar.onRetry = () => {
      if (trackIndex >= 0) void loadTrack(trackIndex);
      else window.postMessage({ source: M2_SOURCE, type: 'refresh' }, '*');
    };
    sidebar.onMine = (from, to, mode, selText) => void mine(from, to, mode, selText);
    sidebar.onGenerate = () => {
      if (gen) gen.stop();
      else void startGeneration();
    };

    // --- Whisper generation (1x: Netflix's player owns the rate; audio is
    // captured via tabCapture which needs the Alt+M activeTab grant) --------

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
      if (v.paused) control('play');
      sidebar.setGenerating(true);
      genCues = [];
      gen = new GenerationSession({
        video: v,
        makeRecorder: tabCaptureChunkRecorder,
        chunkSec: 30,
        transcribe: transcribeChunk,
        onCues: (c) => {
          if (payload?.videoId !== forVideo) return;
          genCues = c;
          if (genSelected) {
            cues = c;
            sidebar.setCues(c);
          }
          void saveGenCues('netflix', forVideo, c);
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

    function pickDefaultTrack(p: VideoTracksPayload): number {
      const score = (i: number): number => {
        const t = p.tracks[i]!;
        if (t.languageCode.startsWith('ja')) return t.label.includes('(CC)') ? 1 : 0;
        return 2;
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
        const res = await fetch(track.url);
        const vtt = await res.text();
        console.debug('[m2:nf] track response:', res.status, `${vtt.length} bytes`);
        if (payload?.videoId !== forVideo || trackIndex !== index) return; // stale
        if (!res.ok || vtt.length === 0) {
          sidebar.setStatus('Subtitle download came back empty.', true);
          return;
        }
        const parsed = parseWebVtt(vtt);
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
      console.debug('[m2:nf] tracks payload', p.videoId, p.tracks.length);
      const isNewVideo = p.videoId !== payload?.videoId;
      payload = p;
      if (p.videoId === null) {
        sidebar.host.remove();
        shrinkStyle.remove();
        overlay.setText(null);
        return;
      }
      if (isNewVideo) {
        cues = [];
        overlay.setText(null);
        gen?.stop();
        genCues = [];
        genSelected = false;
        const forVideo = p.videoId;
        void loadGenCues('netflix', forVideo).then((cached) => {
          if (cached && payload?.videoId === forVideo && !gen) {
            genCues = cached;
            refreshTrackSelect();
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
          'Waiting for Netflix subtitle manifest… (reload the page if this persists, or click ✨ to generate with Whisper)',
        );
        return;
      }
      if (isNewVideo || trackIndex < 0 || trackIndex >= p.tracks.length) {
        void loadTrack(pickDefaultTrack(p));
      } else {
        void loadTrack(trackIndex);
      }
    }

    async function mine(
      from: number,
      to: number,
      mode: MineMode = 'update',
      selText = '',
    ): Promise<void> {
      if (!payload?.videoId || !video) return;
      const span = cues.slice(from, to + 1);
      if (span.length === 0) return;
      if (mining) {
        showToast('Already capturing — wait for the current card.', 'error');
        return;
      }
      const ping = (await browser.runtime.sendMessage({ type: 'm2-anki-check' })) as MineResponse;
      if (!ping.ok) {
        showToast(ping.error, 'error');
        return;
      }
      let front: string | null = null;
      if (mode === 'basic') {
        front = await promptFront(selText);
        if (!front) return;
      }
      mining = true;
      sidebar.setRowBusy(from, to, true);
      try {
        const startMs = span[0]!.start;
        const endMs = span[span.length - 1]!.end;
        const { audioWebm, imageJpeg } = await captureNetflixSpan(video, startMs, endMs, {
          padStartMs: settings.padStartMs,
          padEndMs: settings.padEndMs,
          imageMaxWidth: settings.imageMaxWidth,
          jpegQuality: settings.jpegQuality,
        });
        const mp3 = await webmOpusToMp3(audioWebm);
        const message: MineRequestMessage = {
          type: 'm2-mine',
          mode,
          front: front ?? undefined,
          audioBase64: await blobToBase64(mp3),
          imageBase64: imageJpeg ? await blobToBase64(imageJpeg) : null,
          lines: span.map((c) => c.text),
          video: {
            id: payload.videoId,
            title: payload.title,
            author: payload.author,
            startSec: Math.floor(startMs / 1000),
            url: `https://www.netflix.com/watch/${payload.videoId}?t=${Math.floor(startMs / 1000)}`,
          },
        };
        const res = (await browser.runtime.sendMessage(message)) as MineResponse;
        if (res.ok) {
          showToast(
            mode === 'basic'
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
        sidebar.setRowBusy(from, to, false);
      }
    }

    function ensureMounted(): void {
      if (!payload?.videoId) return;
      const watchVideo = document.querySelector<HTMLElement>('.watch-video');
      if (!watchVideo) return;
      if (!sidebar.host.isConnected) watchVideo.append(sidebar.host);
      // Shrink the player only while the sidebar is actually shown.
      if (sidebarVisible && !shrinkStyle.isConnected) document.head.append(shrinkStyle);
      if (!sidebarVisible) shrinkStyle.remove();
      const playerView = document.querySelector<HTMLElement>('.watch-video--player-view');
      if (playerView) overlay.mount(playerView);
      const currentVideo = document.querySelector<HTMLVideoElement>('.watch-video video, video');
      if (currentVideo !== video) video = currentVideo;
    }

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

    // Alt+M (extension command): mine the current line. The command also
    // grants activeTab, which the tabCapture/captureVisibleTab paths require.
    browser.runtime.onMessage.addListener((msg: { type?: string }) => {
      if (msg?.type !== 'm2-mine-current') return;
      const i = sidebar.activeCueIndex;
      if (i >= 0) void mine(i, i);
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
        e.stopPropagation();
        if (e.code === sidebarCode) {
          sidebarVisible = !sidebarVisible;
          sidebar.setVisible(sidebarVisible);
          ensureMounted();
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
    setInterval(() => {
      if (!video) return;
      const tMs = video.currentTime * 1000;
      const playing = !video.paused;
      if (sidebarVisible) {
        sidebar.updateTime(tMs, playing);
        if (playing && wasPaused) sidebar.recenter();
      }
      wasPaused = !playing;
      overlay.setText(cueAt(tMs)?.text ?? null);
    }, TICK_MS);
    window.postMessage({ source: M2_SOURCE, type: 'refresh' }, '*');
  },
});

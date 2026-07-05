import { parseSrv3 } from '@migaku2/subtitles';
import type { SubtitleCue } from '@migaku2/subtitles';
import { M2_SOURCE, isM2Message } from '../lib/messages';
import type { MineRequestMessage, MineResponse, VideoTracksPayload } from '../lib/messages';
import type { MineMode } from '../lib/messages';
import { captureSpan } from '../lib/capture';
import { webmOpusToMp3 } from '../lib/mp3';
import { Overlay } from '../lib/overlay';
import { promptFront } from '../lib/prompt';
import { Sidebar } from '../lib/sidebar';
import { showToast } from '../lib/toast';

const STORAGE_SIDEBAR_VISIBLE = 'sidebarVisible';
const STORAGE_OVERLAY_VISIBLE = 'overlayVisible';
const MOUNT_CHECK_INTERVAL_MS = 1000;
const TICK_MS = 250;
const AUDIO_PAD_MS = 500;

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
    sidebar.onTrackChange = (i) => void loadTrack(i);
    sidebar.onRetry = () => {
      if (trackIndex >= 0) void loadTrack(trackIndex);
      else requestTracks();
    };
    sidebar.onMine = (from, to, mode, selText) => void mine(from, to, mode, selText);

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
      sidebar.setTracks(payload.tracks, index);
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
      }
      ensureMounted();
      if (p.tracks.length === 0) {
        trackIndex = -1;
        cues = [];
        sidebar.setTracks([], -1);
        sidebar.setCues([]);
        sidebar.setStatus(
          p.source === 'none' ? 'No subtitles found for this video.' : 'No subtitle tracks.',
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
      // Ask for the Front before the (audible) capture starts, so Escape
      // costs nothing.
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
        const { audioWebm, imageJpeg } = await captureSpan(video, startMs, endMs, {
          padMs: AUDIO_PAD_MS,
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

    window.addEventListener(
      'keydown',
      (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.code !== 'KeyG' && e.code !== 'KeyS') return;
        const target = e.target as HTMLElement | null;
        if (
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        if (e.code === 'KeyG') {
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

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

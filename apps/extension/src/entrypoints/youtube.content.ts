import { parseSrv3 } from '@migaku2/subtitles';
import { M2_SOURCE, isM2Message } from '../lib/messages';
import type { VideoTracksPayload } from '../lib/messages';
import { Sidebar } from '../lib/sidebar';

const STORAGE_SIDEBAR_VISIBLE = 'sidebarVisible';
const MOUNT_CHECK_INTERVAL_MS = 1000;

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
  runAt: 'document_idle',
  async main() {
    const sidebar = new Sidebar();
    let payload: VideoTracksPayload | null = null;
    let trackIndex = -1;
    let video: HTMLVideoElement | null = null;

    const stored = await browser.storage.local.get(STORAGE_SIDEBAR_VISIBLE);
    let visible = (stored[STORAGE_SIDEBAR_VISIBLE] as boolean | undefined) ?? true;
    sidebar.setVisible(visible);

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
      sidebar.setCues([]);
      sidebar.setStatus('Loading subtitles…');
      const forVideo = payload.videoId;
      try {
        const url = new URL(track.url, location.origin);
        url.searchParams.set('fmt', 'srv3');
        const res = await fetch(url.toString());
        const xml = await res.text();
        if (payload?.videoId !== forVideo || trackIndex !== index) return; // stale
        if (!res.ok || xml.length === 0) {
          // Empty 200 = missing/invalid POT. The refresh may pick up a
          // player-sourced URL that has one.
          sidebar.setStatus('Subtitles came back empty (YouTube token issue).', true);
          return;
        }
        const cues = parseSrv3(xml);
        if (cues.length === 0) {
          sidebar.setStatus('Track contained no usable lines.', true);
          return;
        }
        sidebar.setStatus(null);
        sidebar.setCues(cues);
      } catch {
        if (payload?.videoId === forVideo && trackIndex === index) {
          sidebar.setStatus('Failed to load subtitles.', true);
        }
      }
    }

    function onTracksPayload(p: VideoTracksPayload): void {
      const isNewVideo = p.videoId !== payload?.videoId;
      payload = p;
      if (p.videoId === null) {
        sidebar.host.remove();
        return;
      }
      ensureMounted();
      if (p.tracks.length === 0) {
        trackIndex = -1;
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

    function ensureMounted(): void {
      if (!payload?.videoId) return;
      if (!sidebar.host.isConnected) {
        // #secondary is the related-videos column on watch pages. Absent in
        // theater/fullscreen and on shorts — sidebar simply stays unmounted.
        const secondary = document.querySelector('#secondary');
        if (secondary) secondary.prepend(sidebar.host);
      }
      const currentVideo = document.querySelector<HTMLVideoElement>('video.html5-main-video');
      if (currentVideo !== video) {
        video?.removeEventListener('timeupdate', onTimeUpdate);
        video = currentVideo;
        video?.addEventListener('timeupdate', onTimeUpdate);
      }
    }

    function onTimeUpdate(): void {
      if (video) sidebar.updateTime(video.currentTime * 1000);
    }

    window.addEventListener('message', (e) => {
      if (e.source !== window || !isM2Message(e.data)) return;
      if (e.data.type === 'tracks') onTracksPayload(e.data.payload);
    });

    window.addEventListener(
      'keydown',
      (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyG') return;
        const target = e.target as HTMLElement | null;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        visible = !visible;
        sidebar.setVisible(visible);
        void browser.storage.local.set({ [STORAGE_SIDEBAR_VISIBLE]: visible });
      },
      true,
    );

    setInterval(ensureMounted, MOUNT_CHECK_INTERVAL_MS);
    requestTracks();
  },
});

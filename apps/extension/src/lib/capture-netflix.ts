import { base64ToBlob } from './blob';
import { M2_SOURCE } from './messages';

// Netflix capture. DRM means captureSpan()'s approach fails twice over:
// captureStream() yields silent tracks on EME media, and canvas drawImage is
// black. Instead: audio via tabCapture (service worker + offscreen document,
// taps the decoded tab output) and screenshot via captureVisibleTab cropped
// to the video rect. Seeking must go through Netflix's player API (relayed
// to the MAIN world) — setting video.currentTime corrupts the player.

export interface NetflixCaptureOptions {
  padStartMs?: number;
  padEndMs?: number;
  imageMaxWidth?: number;
  jpegQuality?: number;
}

export interface NetflixCaptureResult {
  audioWebm: Blob;
  imageJpeg: Blob | null;
}

function control(action: 'seek' | 'play' | 'pause', ms?: number): void {
  window.postMessage({ source: M2_SOURCE, type: 'control', action, ms }, '*');
}

export async function captureNetflixSpan(
  video: HTMLVideoElement,
  startMs: number,
  endMs: number,
  opts: NetflixCaptureOptions = {},
): Promise<NetflixCaptureResult> {
  const t0 = Math.max(0, startMs - (opts.padStartMs ?? 500));
  const t1 = endMs + (opts.padEndMs ?? 500);
  if (!(t1 > t0)) throw new Error('Invalid capture range');
  const prev = { ms: video.currentTime * 1000, paused: video.paused };

  let recording = false;
  let imageJpeg: Blob | null = null;
  try {
    control('pause');
    control('seek', t0);
    console.debug('[m2:nf] capture: seeking to', t0);
    await waitFor(() => Math.abs(video.currentTime * 1000 - t0) < 900, 8000, 'Netflix seek');

    console.debug('[m2:nf] capture: starting tab recording');
    const startRes = (await browser.runtime.sendMessage({ type: 'm2-record-start' })) as {
      ok: boolean;
      error?: string;
    };
    if (!startRes.ok) throw new Error(startRes.error ?? 'Recording failed to start');
    recording = true;
    control('play');
    console.debug('[m2:nf] capture: recording started, playing span');

    const deadline =
      performance.now() + (t1 - t0) / (video.playbackRate || 1) + 10_000;
    await waitUntilTime(video, (t0 + t1) / 2, deadline);
    imageJpeg = await grabNetflixFrame(video, opts).catch(() => null);
    await waitUntilTime(video, t1, deadline);
    control('pause');

    recording = false;
    const stopRes = (await browser.runtime.sendMessage({ type: 'm2-record-stop' })) as {
      ok: boolean;
      error?: string;
      audioBase64?: string;
    };
    if (!stopRes.ok || !stopRes.audioBase64) {
      throw new Error(stopRes.error ?? 'Recording produced no audio');
    }
    return { audioWebm: base64ToBlob(stopRes.audioBase64, 'audio/webm'), imageJpeg };
  } finally {
    if (recording) {
      void browser.runtime.sendMessage({ type: 'm2-record-stop' }).catch(() => {});
    }
    control('pause');
    control('seek', prev.ms);
    if (!prev.paused) control('play');
  }
}

// Netflix chrome that must not appear in card screenshots: its own subtitle
// renders, the control bar, back/flag buttons — plus our overlay.
const SHOT_HIDE_CSS = `
.player-timedtext,
.image-based-subtitles,
.watch-video--bottom-controls-container,
.watch-video--back-container,
.watch-video--flag-container,
[data-uia="player-controls-wrapper"],
#m2-overlay {
  visibility: hidden !important;
}
`;

/** captureVisibleTab (full window) cropped to the video's rect. The bitmap is
 * in physical pixels — multiply CSS rects by devicePixelRatio or the crop
 * lands in the wrong place on Retina displays. */
async function grabNetflixFrame(
  video: HTMLVideoElement,
  opts: NetflixCaptureOptions,
): Promise<Blob> {
  const hide = document.createElement('style');
  hide.textContent = SHOT_HIDE_CSS;
  document.head.append(hide);
  let res: { ok: boolean; error?: string; dataUrl?: string };
  try {
    // Two frames so the hide actually paints before the capture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    res = (await browser.runtime.sendMessage({ type: 'm2-screenshot' })) as typeof res;
  } finally {
    hide.remove();
  }
  if (!res.ok || !res.dataUrl) throw new Error(res.error ?? 'captureVisibleTab failed');
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('screenshot decode failed'));
    img.src = res.dataUrl!;
  });
  const rect = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const srcW = rect.width * dpr;
  const srcH = rect.height * dpr;
  const scale = Math.min(1, (opts.imageMaxWidth ?? 1280) / srcW);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(srcW * scale);
  canvas.height = Math.round(srcH * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, rect.left * dpr, rect.top * dpr, srcW, srcH, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      opts.jpegQuality ?? 0.9,
    );
  });
}

function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    const poll = () => {
      if (cond()) resolve();
      else if (performance.now() >= deadline) reject(new Error(`${what} timed out`));
      else setTimeout(poll, 100);
    };
    poll();
  });
}

function waitUntilTime(video: HTMLVideoElement, targetMs: number, deadline: number): Promise<void> {
  return new Promise((resolve) => {
    const poll = () => {
      if (video.currentTime * 1000 >= targetMs || performance.now() >= deadline) resolve();
      else setTimeout(poll, 50);
    };
    poll();
  });
}

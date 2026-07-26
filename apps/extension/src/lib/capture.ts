// Sentence audio + screenshot capture. There is no way to extract past audio
// from a media element, so the span is replayed in real time while recording
// the element's captureStream(). captureStream records at the media's raw
// volume regardless of the element's volume/mute — which is what we want for
// cards. Works on YouTube because there is no DRM.

export interface CaptureOptions {
  padStartMs?: number;
  padEndMs?: number;
  /** Explicit screenshot time; defaults to the final audio range midpoint. */
  imageTimeMs?: number;
  imageMaxWidth?: number;
  jpegQuality?: number;
}

export interface CaptureResult {
  audioWebm: Blob;
  /** null if frame capture failed; audio alone is still useful. */
  imageJpeg: Blob | null;
}

interface CapturableVideo extends HTMLVideoElement {
  captureStream?: () => MediaStream;
}

export async function captureSpan(
  video: HTMLVideoElement,
  startMs: number,
  endMs: number,
  opts: CaptureOptions = {},
): Promise<CaptureResult> {
  const t0 = Math.max(0, (startMs - (opts.padStartMs ?? 500)) / 1000);
  const t1 = Math.min(
    Number.isFinite(video.duration) ? video.duration : Infinity,
    (endMs + (opts.padEndMs ?? 500)) / 1000,
  );
  if (!(t1 > t0)) throw new Error('Invalid capture range');
  const imageTime =
    opts.imageTimeMs === undefined
      ? (t0 + t1) / 2
      : Math.min(t1, Math.max(t0, opts.imageTimeMs / 1000));

  const captureStream = (video as CapturableVideo).captureStream?.bind(video);
  if (!captureStream) throw new Error('captureStream unsupported on this video');
  const audioTracks = captureStream().getAudioTracks();
  if (audioTracks.length === 0) throw new Error('Video has no capturable audio track');

  const prev = { time: video.currentTime, paused: video.paused };
  const recorder = new MediaRecorder(new MediaStream(audioTracks), {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  let imageJpeg: Blob | null = null;
  try {
    await seekTo(video, t0);
    recorder.start();
    await video.play();
    // Hard cap in case the video stalls: span duration + generous slack.
    const capMs = ((t1 - t0) / (video.playbackRate || 1)) * 1000 + 8000;
    const deadline = performance.now() + capMs;
    await waitUntilTime(video, imageTime, deadline);
    imageJpeg = await grabFrame(video, opts).catch(() => null);
    await waitUntilTime(video, t1, deadline);
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    video.pause();
    video.currentTime = prev.time;
    if (!prev.paused) void video.play().catch(() => {});
  }
  await stopped;

  if (chunks.length === 0) throw new Error('Audio recording produced no data');
  return { audioWebm: new Blob(chunks, { type: 'audio/webm' }), imageJpeg };
}

function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      reject(new Error('Seek timed out'));
    }, 5000);
    const onSeeked = () => {
      clearTimeout(timer);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = timeSec;
  });
}

function waitUntilTime(video: HTMLVideoElement, targetSec: number, deadline: number): Promise<void> {
  return new Promise((resolve) => {
    const poll = () => {
      if (video.currentTime >= targetSec || performance.now() >= deadline) resolve();
      else setTimeout(poll, 50);
    };
    poll();
  });
}

async function grabFrame(video: HTMLVideoElement, opts: CaptureOptions): Promise<Blob> {
  const maxWidth = opts.imageMaxWidth ?? 1280;
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      opts.jpegQuality ?? 0.9,
    );
  });
}

import type { SubtitleCue } from '@migaku2/subtitles';
import { base64ToBlob } from './blob';
import { webmToWav16kMono } from './wav';

// Whisper subtitle generation. There is no fast path to a video's audio
// (googlevideo enforces GVS PO tokens as of 2025/26 — verified empirically),
// so audio is captured from playback in rolling chunks and transcribed
// progressively. Timestamps are mapped through the *measured* video-time
// span of each chunk, which makes accelerated playback (YouTube 2x) free.

export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

/** One chunk = one standalone webm (MediaRecorder timeslice blobs after the
 * first lack the container header, so the recorder is restarted per chunk). */
export interface ChunkRecorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
}

export interface GenerationOptions {
  video: HTMLVideoElement;
  makeRecorder: () => ChunkRecorder;
  /** Wall-clock seconds per chunk. */
  chunkSec: number;
  transcribe: (wav: Blob, offsetMs: number, scale: number) => Promise<Segment[]>;
  onCues: (cues: SubtitleCue[]) => void;
  onStatus: (status: string | null) => void;
}

const POLL_MS = 200;
/** currentTime deviating this far from expectation = the user seeked. */
const SEEK_TOLERANCE_SEC = 3;

export class GenerationSession {
  private stopped = false;
  private cues: SubtitleCue[] = [];
  private pending = 0;
  private chunksDone = 0;

  constructor(private readonly opts: GenerationOptions) {}

  stop(): void {
    this.stopped = true;
  }

  /** Runs until video end or stop(); resolves with all cues. */
  async run(): Promise<SubtitleCue[]> {
    const { video } = this.opts;
    this.status();
    while (!this.stopped && !video.ended) {
      if (video.paused) {
        await sleep(POLL_MS);
        continue;
      }
      await this.recordOneChunk();
    }
    while (this.pending > 0) {
      this.status('finishing');
      await sleep(POLL_MS);
    }
    this.opts.onStatus(null);
    return this.cues;
  }

  private async recordOneChunk(): Promise<void> {
    const { video, chunkSec } = this.opts;
    const recorder = this.opts.makeRecorder();
    const videoStart = video.currentTime;
    await recorder.start();
    const wallStart = performance.now();
    let seeked = false;

    while (!this.stopped && !video.paused && !video.ended) {
      const wallSec = (performance.now() - wallStart) / 1000;
      if (wallSec >= chunkSec) break;
      const expected = videoStart + wallSec * (video.playbackRate || 1);
      if (Math.abs(video.currentTime - expected) > SEEK_TOLERANCE_SEC) {
        seeked = true;
        break;
      }
      await sleep(POLL_MS);
    }
    const videoEnd = video.currentTime;
    const webm = await recorder.stop();

    if (seeked) return; // pre/post-seek audio is mixed — unusable mapping
    if (videoEnd - videoStart < 1) return; // too short to bother
    this.pending++;
    this.status();
    void this.process(webm, videoStart, videoEnd)
      .catch(() => {
        // one failed chunk shouldn't kill the session; gap stays untranscribed
      })
      .finally(() => {
        this.pending--;
        this.chunksDone++;
        this.status();
      });
  }

  private async process(webm: Blob, videoStartSec: number, videoEndSec: number): Promise<void> {
    const wav = await webmToWav16kMono(webm);
    if (wav.durationSec < 0.5) return;
    const scale = clamp((videoEndSec - videoStartSec) / wav.durationSec, 0.5, 4);
    const segments = await this.opts.transcribe(wav.blob, Math.round(videoStartSec * 1000), scale);
    if (this.stoppedAndFlushed()) return;
    for (const s of segments) {
      if (s.endMs - s.startMs < 100) continue;
      this.cues.push({ start: s.startMs, end: s.endMs, text: s.text });
    }
    this.cues.sort((a, b) => a.start - b.start);
    this.opts.onCues([...this.cues]);
  }

  private stoppedAndFlushed(): boolean {
    return false; // cues are still useful after stop; keep collecting
  }

  private status(phase?: string): void {
    const parts = [`Whisper: ${this.cues.length} lines`];
    if (this.pending > 0) parts.push(`${this.pending} chunk${this.pending > 1 ? 's' : ''} transcribing`);
    if (phase) parts.push(phase);
    this.opts.onStatus(parts.join(' · '));
  }
}

/** captureStream-based recorder (YouTube: no DRM, per-element, silent-safe). */
export function elementChunkRecorder(video: HTMLVideoElement): ChunkRecorder {
  let recorder: MediaRecorder | null = null;
  const chunks: BlobPart[] = [];
  return {
    async start() {
      const stream = (video as HTMLVideoElement & { captureStream?: () => MediaStream })
        .captureStream?.();
      const tracks = stream?.getAudioTracks() ?? [];
      if (tracks.length === 0) throw new Error('No capturable audio track');
      recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128_000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
    },
    async stop() {
      const rec = recorder;
      if (!rec) throw new Error('recorder not started');
      const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      rec.stream.getTracks().forEach((t) => t.stop());
      return new Blob(chunks, { type: 'audio/webm' });
    },
  };
}

/** tabCapture-based recorder via the service worker + offscreen document
 * (Netflix — DRM-safe; requires the Alt+M activeTab grant). */
export function tabCaptureChunkRecorder(): ChunkRecorder {
  return {
    async start() {
      const res = (await browser.runtime.sendMessage({ type: 'm2-record-start' })) as {
        ok: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(res.error ?? 'Recording failed to start');
    },
    async stop() {
      const res = (await browser.runtime.sendMessage({ type: 'm2-record-stop' })) as {
        ok: boolean;
        error?: string;
        audioBase64?: string;
      };
      if (!res.ok || !res.audioBase64) throw new Error(res.error ?? 'Recording produced no audio');
      return base64ToBlob(res.audioBase64, 'audio/webm');
    },
  };
}

// --- generated-track cache (chrome.storage.local, unlimitedStorage) ---

const cacheKey = (site: string, videoId: string): string => `gen:${site}:${videoId}`;

export async function loadGenCues(site: string, videoId: string): Promise<SubtitleCue[] | null> {
  const key = cacheKey(site, videoId);
  const stored = await browser.storage.local.get(key);
  const cues = stored[key] as SubtitleCue[] | undefined;
  return Array.isArray(cues) && cues.length > 0 ? cues : null;
}

export async function saveGenCues(site: string, videoId: string, cues: SubtitleCue[]): Promise<void> {
  await browser.storage.local.set({ [cacheKey(site, videoId)]: cues });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

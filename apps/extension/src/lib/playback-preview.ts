export interface PlaybackController {
  video: HTMLVideoElement;
  pause: () => void;
  play: () => void;
  seek: (timeMs: number) => void;
  /** Netflix seeks are coarser than direct HTMLMediaElement seeks. */
  seekToleranceMs?: number;
}

interface PlaybackState {
  timeMs: number;
  paused: boolean;
}

const POLL_MS = 50;

/** Owns temporary player seeks while the capture editor is open. */
export class PlaybackPreviewSession {
  private readonly original: PlaybackState;
  private generation = 0;

  constructor(private readonly controller: PlaybackController) {
    this.original = {
      timeMs: controller.video.currentTime * 1000,
      paused: controller.video.paused,
    };
  }

  showFrame(timeMs: number): void {
    this.generation++;
    this.controller.pause();
    this.controller.seek(timeMs);
  }

  async playRange(startMs: number, endMs: number, returnMs: number): Promise<void> {
    const generation = ++this.generation;
    this.controller.pause();
    this.controller.seek(startMs);
    await this.waitForSeek(startMs, generation);
    if (generation !== this.generation) return;
    this.controller.play();
    while (
      generation === this.generation &&
      this.controller.video.currentTime * 1000 < endMs
    ) {
      await sleep(POLL_MS);
    }
    if (generation !== this.generation) return;
    this.controller.pause();
    this.controller.seek(returnMs);
  }

  async restore(): Promise<void> {
    const generation = ++this.generation;
    this.controller.pause();
    this.controller.seek(this.original.timeMs);
    await this.waitForSeek(this.original.timeMs, generation);
    if (!this.original.paused && generation === this.generation) this.controller.play();
  }

  stop(): void {
    this.generation++;
    this.controller.pause();
  }

  private async waitForSeek(targetMs: number, generation: number): Promise<void> {
    const tolerance = this.controller.seekToleranceMs ?? 120;
    const deadline = performance.now() + 6000;
    while (
      generation === this.generation &&
      Math.abs(this.controller.video.currentTime * 1000 - targetMs) > tolerance &&
      performance.now() < deadline
    ) {
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

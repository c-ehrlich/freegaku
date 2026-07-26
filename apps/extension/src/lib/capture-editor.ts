export interface CaptureDraft {
  startMs: number;
  endMs: number;
  imageMs: number;
}

export interface CaptureEditorOptions extends CaptureDraft {
  windowStartMs: number;
  windowEndMs: number;
  cueRanges: Array<{ startMs: number; endMs: number }>;
  selectedLineCount: number;
  onFrameChange: (timeMs: number) => void;
  onPreviewAudio: (draft: CaptureDraft) => Promise<void>;
  /** Return false to keep the editor open (for example, a cancelled prompt). */
  onConfirm: (draft: CaptureDraft) => Promise<boolean>;
  onCancel: () => void;
}

const MIN_AUDIO_MS = 250;
const FRAME_DEBOUNCE_MS = 250;

const CSS = `
#m2-sidebar .m2-capture-editor {
  --m2-editor-accent: #3ea6ff;
  --m2-editor-ink: #0f0f0f;
  --m2-editor-muted: #606060;
  --m2-editor-panel: rgba(255, 255, 255, 0.86);
  --m2-editor-track: rgba(15, 15, 15, 0.13);
  --m2-editor-cue: rgba(62, 166, 255, 0.11);
  display: none;
  flex: none;
  padding: 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.28);
  background: var(--m2-editor-panel);
  color: var(--m2-editor-ink);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(14px);
}
html[dark] #m2-sidebar .m2-capture-editor,
#m2-sidebar.m2-nf .m2-capture-editor {
  --m2-editor-ink: #f1f1f1;
  --m2-editor-muted: #aaa;
  --m2-editor-panel: rgba(20, 20, 20, 0.94);
  --m2-editor-track: rgba(255, 255, 255, 0.16);
  --m2-editor-cue: rgba(62, 166, 255, 0.13);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.24);
}
#m2-sidebar .m2-capture-editor.m2-open {
  display: block;
  animation: m2-editor-in 140ms ease-out;
}
@keyframes m2-editor-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
#m2-sidebar .m2-editor-heading,
#m2-sidebar .m2-editor-section-head,
#m2-sidebar .m2-editor-actions {
  display: flex;
  align-items: center;
}
#m2-sidebar .m2-editor-heading {
  justify-content: space-between;
  margin-bottom: 12px;
}
#m2-sidebar .m2-editor-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
#m2-sidebar .m2-editor-lines,
#m2-sidebar .m2-editor-readout,
#m2-sidebar .m2-editor-hint {
  color: var(--m2-editor-muted);
  font-size: 11px;
}
#m2-sidebar .m2-editor-section + .m2-editor-section {
  margin-top: 14px;
}
#m2-sidebar .m2-editor-section-head {
  justify-content: space-between;
  margin-bottom: 7px;
}
#m2-sidebar .m2-editor-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
#m2-sidebar .m2-editor-audio-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  align-items: center;
  gap: 8px;
}
#m2-sidebar .m2-editor-range {
  position: relative;
  height: 42px;
}
#m2-sidebar .m2-editor-track,
#m2-sidebar .m2-editor-fill {
  position: absolute;
  left: 7px;
  right: 7px;
  top: 25px;
  height: 4px;
  border-radius: 99px;
  pointer-events: none;
}
#m2-sidebar .m2-editor-track {
  background: var(--m2-editor-track);
}
#m2-sidebar .m2-editor-cues {
  position: absolute;
  left: 7px;
  right: 7px;
  top: 0;
  height: 15px;
  overflow: visible;
  pointer-events: none;
}
#m2-sidebar .m2-editor-cue {
  position: absolute;
  top: 0;
  box-sizing: border-box;
  height: 15px;
  overflow: visible;
  border: 1px solid rgba(62, 166, 255, 0.62);
  border-radius: 3px;
  background: rgba(62, 166, 255, 0.15);
  color: var(--m2-editor-accent);
  font-size: 9px;
  font-weight: 700;
  line-height: 13px;
  text-align: center;
}
#m2-sidebar .m2-editor-cue:nth-child(even) {
  background: rgba(62, 166, 255, 0.25);
}
#m2-sidebar .m2-editor-cue::after {
  content: "";
  position: absolute;
  left: -1px;
  top: 14px;
  height: 12px;
  border-left: 1px solid rgba(62, 166, 255, 0.62);
}
#m2-sidebar .m2-editor-cue:last-child::before {
  content: "";
  position: absolute;
  right: -1px;
  top: 14px;
  height: 12px;
  border-right: 1px solid rgba(62, 166, 255, 0.62);
}
#m2-sidebar .m2-editor-fill {
  left: calc(7px + (100% - 14px) * var(--m2-from));
  right: calc(7px + (100% - 14px) * (1 - var(--m2-to)));
  background: var(--m2-editor-accent);
  box-shadow: 0 0 9px rgba(62, 166, 255, 0.32);
}
#m2-sidebar .m2-editor-slider {
  position: absolute;
  left: 0;
  right: 0;
  top: 12px;
  width: 100%;
  height: 30px;
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  pointer-events: none;
}
#m2-sidebar .m2-editor-slider::-webkit-slider-runnable-track {
  height: 4px;
  background: transparent;
}
#m2-sidebar .m2-editor-slider::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  margin-top: -6px;
  appearance: none;
  -webkit-appearance: none;
  border: 2px solid var(--m2-editor-panel);
  border-radius: 50%;
  background: var(--m2-editor-accent);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
  cursor: ew-resize;
  pointer-events: auto;
}
#m2-sidebar .m2-editor-frame-slider {
  position: static;
  display: block;
  pointer-events: auto;
}
#m2-sidebar .m2-editor-frame-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 99px;
  background: linear-gradient(
    to right,
    var(--m2-editor-track) 0%,
    var(--m2-editor-track) var(--m2-frame-from),
    var(--m2-editor-accent) var(--m2-frame-from),
    var(--m2-editor-accent) var(--m2-frame-to),
    var(--m2-editor-track) var(--m2-frame-to),
    var(--m2-editor-track) 100%
  );
}
#m2-sidebar .m2-editor-play,
#m2-sidebar .m2-editor-button,
#m2-sidebar .m2-editor-close {
  border: none;
  font: inherit;
  cursor: pointer;
}
#m2-sidebar .m2-editor-play {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  background: rgba(62, 166, 255, 0.16);
  color: var(--m2-editor-accent);
  font-size: 13px;
}
#m2-sidebar .m2-editor-play:hover {
  background: rgba(62, 166, 255, 0.25);
}
#m2-sidebar .m2-editor-close {
  padding: 2px 4px;
  background: transparent;
  color: var(--m2-editor-muted);
  font-size: 18px;
  line-height: 1;
}
#m2-sidebar .m2-editor-time-row {
  display: flex;
  justify-content: space-between;
  padding-right: 40px;
  margin-top: -2px;
  color: var(--m2-editor-muted);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
}
#m2-sidebar .m2-editor-hint {
  margin-top: 4px;
}
#m2-sidebar .m2-editor-actions {
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
#m2-sidebar .m2-editor-button {
  padding: 7px 11px;
  border-radius: 7px;
  background: transparent;
  color: var(--m2-editor-muted);
  font-size: 12px;
  font-weight: 500;
}
#m2-sidebar .m2-editor-button:hover {
  background: rgba(128, 128, 128, 0.14);
}
#m2-sidebar .m2-editor-button.m2-primary {
  background: var(--m2-editor-accent);
  color: #fff;
}
#m2-sidebar .m2-editor-button.m2-primary:hover {
  background: #2d96eb;
}
#m2-sidebar .m2-capture-editor.m2-busy button,
#m2-sidebar .m2-capture-editor.m2-busy input {
  pointer-events: none;
  opacity: 0.58;
}
`;

export class CaptureEditor {
  readonly host: HTMLElement;
  private readonly fromInput: HTMLInputElement;
  private readonly toInput: HTMLInputElement;
  private readonly frameInput: HTMLInputElement;
  private readonly rangeEl: HTMLElement;
  private readonly cuesEl: HTMLElement;
  private readonly startLabel: HTMLElement;
  private readonly endLabel: HTMLElement;
  private readonly durationLabel: HTMLElement;
  private readonly frameLabel: HTMLElement;
  private readonly lineLabel: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly confirmButton: HTMLButtonElement;
  private options: CaptureEditorOptions | null = null;
  private frameTimer: number | undefined;
  private previewing = false;

  constructor() {
    this.host = document.createElement('section');
    this.host.className = 'm2-capture-editor';
    this.host.setAttribute('aria-label', 'Adjust audio and screenshot');

    const style = document.createElement('style');
    style.textContent = CSS;

    const heading = element('div', 'm2-editor-heading');
    const title = element('span', 'm2-editor-title', 'Edit capture');
    this.lineLabel = element('span', 'm2-editor-lines');
    const close = button('m2-editor-close', '×', 'Cancel editing');
    close.addEventListener('click', () => this.cancel());
    heading.append(title, this.lineLabel, close);

    const audioSection = element('div', 'm2-editor-section');
    const audioHead = element('div', 'm2-editor-section-head');
    audioHead.append(
      element('span', 'm2-editor-label', 'Audio'),
      (this.durationLabel = element('span', 'm2-editor-readout')),
    );
    const audioRow = element('div', 'm2-editor-audio-row');
    this.rangeEl = element('div', 'm2-editor-range');
    this.rangeEl.append(
      element('div', 'm2-editor-track'),
      (this.cuesEl = element('div', 'm2-editor-cues')),
      element('div', 'm2-editor-fill'),
    );
    this.fromInput = rangeInput('Audio start');
    this.toInput = rangeInput('Audio end');
    this.rangeEl.append(this.fromInput, this.toInput);
    this.playButton = button('m2-editor-play', '▶', 'Preview selected audio');
    audioRow.append(this.rangeEl, this.playButton);
    const timeRow = element('div', 'm2-editor-time-row');
    timeRow.append(
      (this.startLabel = element('span')),
      (this.endLabel = element('span')),
    );
    audioSection.append(audioHead, audioRow, timeRow);

    const frameSection = element('div', 'm2-editor-section');
    const frameHead = element('div', 'm2-editor-section-head');
    frameHead.append(
      element('span', 'm2-editor-label', 'Screenshot frame'),
      (this.frameLabel = element('span', 'm2-editor-readout')),
    );
    this.frameInput = rangeInput('Screenshot time');
    this.frameInput.classList.add('m2-editor-frame-slider');
    frameSection.append(
      frameHead,
      this.frameInput,
      element('div', 'm2-editor-hint', 'Preview updates in the video'),
    );

    const actions = element('div', 'm2-editor-actions');
    const cancel = button('m2-editor-button', 'Cancel');
    this.confirmButton = button('m2-editor-button m2-primary', 'Add to Anki');
    cancel.addEventListener('click', () => this.cancel());
    actions.append(cancel, this.confirmButton);

    this.host.append(style, heading, audioSection, frameSection, actions);

    this.fromInput.addEventListener('input', () => this.onAudioInput('from'));
    this.toInput.addEventListener('input', () => this.onAudioInput('to'));
    this.frameInput.addEventListener('input', () => this.onFrameInput());
    this.playButton.addEventListener('click', () => void this.previewAudio());
    this.confirmButton.addEventListener('click', () => void this.confirm());
    this.host.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') this.cancel();
    });
  }

  get isOpen(): boolean {
    return this.options !== null;
  }

  open(options: CaptureEditorOptions): void {
    if (this.options) this.cancel();
    this.options = options;
    const min = Math.round(options.windowStartMs);
    const max = Math.round(options.windowEndMs);
    for (const input of [this.fromInput, this.toInput, this.frameInput]) {
      input.min = String(min);
      input.max = String(max);
      input.step = '50';
    }
    this.fromInput.value = String(Math.round(options.startMs));
    this.toInput.value = String(Math.round(options.endMs));
    this.frameInput.value = String(Math.round(options.imageMs));
    this.lineLabel.textContent =
      options.selectedLineCount === 1 ? '1 selected line' : `${options.selectedLineCount} selected lines`;
    this.renderCueRanges(options);
    this.render();
    this.host.classList.add('m2-open');
    this.scheduleFramePreview();
  }

  cancel(): void {
    const options = this.options;
    if (!options) return;
    this.close();
    options.onCancel();
  }

  close(): void {
    clearTimeout(this.frameTimer);
    this.frameTimer = undefined;
    this.options = null;
    this.previewing = false;
    this.host.classList.remove('m2-open', 'm2-busy');
    this.playButton.textContent = '▶';
    this.playButton.title = 'Preview selected audio';
    this.confirmButton.textContent = 'Add to Anki';
  }

  private draft(): CaptureDraft {
    return {
      startMs: Number(this.fromInput.value),
      endMs: Number(this.toInput.value),
      imageMs: Number(this.frameInput.value),
    };
  }

  private onAudioInput(changed: 'from' | 'to'): void {
    let start = Number(this.fromInput.value);
    let end = Number(this.toInput.value);
    if (changed === 'from' && start > end - MIN_AUDIO_MS) {
      start = end - MIN_AUDIO_MS;
      this.fromInput.value = String(start);
    } else if (changed === 'to' && end < start + MIN_AUDIO_MS) {
      end = start + MIN_AUDIO_MS;
      this.toInput.value = String(end);
    }
    const image = clamp(Number(this.frameInput.value), start, end);
    if (image !== Number(this.frameInput.value)) {
      this.frameInput.value = String(image);
      this.scheduleFramePreview();
    }
    if (this.previewing) this.options?.onFrameChange(image);
    this.render();
  }

  private onFrameInput(): void {
    const { startMs, endMs } = this.draft();
    this.frameInput.value = String(clamp(Number(this.frameInput.value), startMs, endMs));
    this.render();
    this.scheduleFramePreview();
  }

  private render(): void {
    const options = this.options;
    if (!options) return;
    const draft = this.draft();
    const width = Math.max(1, options.windowEndMs - options.windowStartMs);
    const from = (draft.startMs - options.windowStartMs) / width;
    const to = (draft.endMs - options.windowStartMs) / width;
    this.rangeEl.style.setProperty('--m2-from', String(from));
    this.rangeEl.style.setProperty('--m2-to', String(to));
    this.frameInput.style.setProperty('--m2-frame-from', `${from * 100}%`);
    this.frameInput.style.setProperty('--m2-frame-to', `${to * 100}%`);
    this.startLabel.textContent = formatTimestamp(draft.startMs);
    this.endLabel.textContent = formatTimestamp(draft.endMs);
    this.durationLabel.textContent = `${((draft.endMs - draft.startMs) / 1000).toFixed(2)} seconds`;
    this.frameLabel.textContent = formatTimestamp(draft.imageMs);
  }

  private renderCueRanges(options: CaptureEditorOptions): void {
    const width = Math.max(1, options.windowEndMs - options.windowStartMs);
    this.cuesEl.replaceChildren(
      ...options.cueRanges.map((range, index) => {
        const cue = element('span', 'm2-editor-cue');
        const left = clamp((range.startMs - options.windowStartMs) / width, 0, 1);
        const right = clamp((range.endMs - options.windowStartMs) / width, 0, 1);
        cue.style.left = `${left * 100}%`;
        cue.style.width = `${Math.max(0, right - left) * 100}%`;
        cue.textContent = String(index + 1);
        cue.title = `Selected line ${index + 1}`;
        return cue;
      }),
    );
  }

  private scheduleFramePreview(): void {
    clearTimeout(this.frameTimer);
    this.frameTimer = window.setTimeout(() => {
      this.frameTimer = undefined;
      this.options?.onFrameChange(this.draft().imageMs);
    }, FRAME_DEBOUNCE_MS);
  }

  private async previewAudio(): Promise<void> {
    if (!this.options) return;
    if (this.previewing) {
      this.options.onFrameChange(this.draft().imageMs);
      return;
    }
    clearTimeout(this.frameTimer);
    this.previewing = true;
    this.playButton.textContent = '■';
    this.playButton.title = 'Playing preview';
    try {
      await this.options.onPreviewAudio(this.draft());
    } finally {
      this.previewing = false;
      this.playButton.textContent = '▶';
      this.playButton.title = 'Preview selected audio';
    }
  }

  private async confirm(): Promise<void> {
    if (!this.options) return;
    const options = this.options;
    clearTimeout(this.frameTimer);
    this.frameTimer = undefined;
    if (this.previewing) options.onFrameChange(this.draft().imageMs);
    this.host.classList.add('m2-busy');
    this.confirmButton.textContent = 'Adding…';
    try {
      const shouldClose = await options.onConfirm(this.draft());
      if (shouldClose && this.options === options) this.close();
    } finally {
      if (this.options === options) {
        this.host.classList.remove('m2-busy');
        this.confirmButton.textContent = 'Add to Anki';
      }
    }
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function button(className: string, text: string, title = ''): HTMLButtonElement {
  const el = element('button', className, text);
  el.type = 'button';
  el.title = title;
  return el;
}

function rangeInput(label: string): HTMLInputElement {
  const input = element('input', 'm2-editor-slider');
  input.type = 'range';
  input.setAttribute('aria-label', label);
  return input;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

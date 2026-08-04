import type { SubtitleCue } from '@migaku2/subtitles';
import { CaptureEditor } from './capture-editor';
import type { CaptureEditorOptions } from './capture-editor';
import type { TrackInfo } from './messages';
import { showToast } from './toast';

export interface SidebarMineRequest {
  from: number;
  to: number;
  mode: 'update' | 'basic';
  selText: string;
  /** Text dragging opens the timing editor; row ＋ and Alt+M stay one-step. */
  adjust: boolean;
  /** Character offsets within the first/last touched cue. */
  startOffset?: number;
  endOffset?: number;
}

// Plain DOM, no shadow root: Yomitan must be able to scan the subtitle text,
// and shadow-root piercing is not something we can rely on. All styles are
// namespaced under #m2-sidebar and scoped with high-specificity selectors.
//
// YouTube sets <html dark> in dark mode; its --yt-spec-* vars aren't reliably
// resolvable from injected elements, so colors are explicit per theme.
const CSS = `
#m2-sidebar {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 12px;
  margin-bottom: 16px;
  font-family: "Roboto", "Noto Sans JP", sans-serif;
  color: #0f0f0f;
  overflow: hidden;
}
html[dark] #m2-sidebar {
  background: rgba(255, 255, 255, 0.08);
  color: #f1f1f1;
}
#m2-sidebar .m2-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}
#m2-sidebar .m2-title {
  font-size: 13px;
  font-weight: 500;
  flex: none;
}
#m2-sidebar .m2-track-select {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: transparent;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  padding: 3px 6px;
}
#m2-sidebar .m2-track-select option {
  color: initial;
  background: initial;
}
#m2-sidebar .m2-header-action {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: transparent;
  font-size: 15px;
  line-height: 28px;
  text-align: center;
  cursor: pointer;
  padding: 0;
}
#m2-sidebar .m2-header-action:hover:not(:disabled) {
  background: rgba(128, 128, 128, 0.2);
}
#m2-sidebar .m2-header-action:disabled {
  cursor: default;
  opacity: 0.35;
}
#m2-sidebar .m2-status {
  padding: 14px 12px;
  font-size: 13px;
  color: #606060;
}
html[dark] #m2-sidebar .m2-status {
  color: #aaa;
}
#m2-sidebar .m2-status button {
  font: inherit;
  color: #3ea6ff;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-left: 6px;
}
#m2-sidebar .m2-list {
  position: relative;
  max-height: calc(100vh - 280px);
  min-height: 120px;
  overflow-y: auto;
  padding: 6px;
}
#m2-sidebar.m2-editing .m2-list {
  max-height: calc(100vh - 530px);
  min-height: 80px;
}
#m2-sidebar .m2-row {
  display: flex;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 8px;
  cursor: default;
}
#m2-sidebar .m2-row:hover {
  background: rgba(128, 128, 128, 0.15);
}
#m2-sidebar .m2-row.m2-active {
  background: rgba(62, 166, 255, 0.15);
}
#m2-sidebar .m2-time {
  font: inherit;
  font-size: 11px;
  line-height: 24px;
  color: #3ea6ff;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  min-width: 40px;
  text-align: right;
  flex: none;
  user-select: none;
  -webkit-user-select: none;
}
#m2-sidebar .m2-text {
  flex: 1;
  font-size: 16px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: inherit;
}
#m2-sidebar .m2-add {
  flex: none;
  align-self: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: rgba(62, 166, 255, 0.18);
  color: #3ea6ff;
  font-size: 17px;
  line-height: 26px;
  text-align: center;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transition: opacity 0.12s;
  user-select: none;
  -webkit-user-select: none;
}
#m2-sidebar .m2-row:hover .m2-add {
  opacity: 1;
}
#m2-sidebar .m2-row.m2-busy .m2-add {
  opacity: 1;
  pointer-events: none;
}
#m2-sidebar #m2-chip {
  position: fixed;
  z-index: 2147483000;
  transform: translate(-50%, 0);
  background: #3ea6ff;
  color: #fff;
  border: none;
  border-radius: 16px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  display: none;
}
`;

export class Sidebar {
  readonly host: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly selectEl: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private readonly chipEl: HTMLButtonElement;
  private readonly captureEditor: CaptureEditor;
  private genEl!: HTMLButtonElement;
  private copyEl!: HTMLButtonElement;
  private copyResetTimeout: number | undefined;
  private rows: HTMLElement[] = [];
  private cues: SubtitleCue[] = [];
  private activeIndex = -1;
  private hovering = false;
  private chipSpan: SidebarMineRequest | null = null;

  onSeek?: (ms: number) => void;
  onTrackChange?: (index: number) => void;
  onRetry?: () => void;
  /** Mine cue lines [from..to] (inclusive; from === to for a single line).
   * mode 'basic' (Alt+click) creates a standalone Basic card; selText is the
   * text that was selected when the action fired (Front prefill). */
  onMine?: (request: SidebarMineRequest) => void;
  /** ✨ button: start (or stop, while running) Whisper generation. */
  onGenerate?: () => void;

  setGenerating(running: boolean): void {
    this.genEl.textContent = running ? '⏹' : '✨';
    this.genEl.title = running ? 'Stop generating' : 'Generate subtitles with Whisper';
  }

  constructor() {
    this.host = document.createElement('div');
    this.host.id = 'm2-sidebar';

    const style = document.createElement('style');
    style.textContent = CSS;
    this.host.append(style);

    const header = document.createElement('div');
    header.className = 'm2-header';
    const title = document.createElement('span');
    title.className = 'm2-title';
    title.textContent = 'Subtitles';
    this.selectEl = document.createElement('select');
    this.selectEl.className = 'm2-track-select';
    this.selectEl.addEventListener('change', () => {
      this.onTrackChange?.(this.selectEl.selectedIndex);
    });
    this.genEl = document.createElement('button');
    this.genEl.className = 'm2-header-action m2-gen';
    this.genEl.textContent = '✨';
    this.genEl.title = 'Generate subtitles with Whisper';
    this.genEl.ariaLabel = 'Generate subtitles with Whisper';
    this.genEl.addEventListener('click', () => this.onGenerate?.());
    this.copyEl = document.createElement('button');
    this.copyEl.className = 'm2-header-action m2-copy';
    this.copyEl.textContent = '📋';
    this.copyEl.title = 'No subtitles to copy';
    this.copyEl.ariaLabel = 'Copy all subtitles';
    this.copyEl.disabled = true;
    this.copyEl.addEventListener('click', () => void this.copySubtitles());
    header.append(title, this.selectEl, this.genEl, this.copyEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'm2-status';
    this.statusEl.hidden = true;

    this.listEl = document.createElement('div');
    this.listEl.className = 'm2-list';
    this.listEl.addEventListener('mouseenter', () => (this.hovering = true));
    this.listEl.addEventListener('mouseleave', () => (this.hovering = false));

    this.captureEditor = new CaptureEditor();

    // Floating adjustment chip shown for any subtitle text selection.
    // position: fixed escapes the host's overflow clipping.
    this.chipEl = document.createElement('button');
    this.chipEl.id = 'm2-chip';
    // Keep the selection alive: a mousedown would collapse it before click.
    this.chipEl.addEventListener('mousedown', (e) => e.preventDefault());
    this.chipEl.addEventListener('click', (e) => {
      const span = this.chipSpan;
      this.hideChip();
      window.getSelection()?.removeAllRanges();
      if (span) {
        this.onMine?.({ ...span, mode: e.altKey ? 'basic' : 'update' });
      }
    });
    document.addEventListener('selectionchange', () => {
      clearTimeout(this.selDebounce);
      this.selDebounce = window.setTimeout(() => this.updateChip(), 150);
    });

    this.host.append(header, this.statusEl, this.listEl, this.captureEditor.host, this.chipEl);
  }

  private selDebounce: number | undefined;

  setTracks(tracks: TrackInfo[], selectedIndex: number): void {
    this.selectEl.replaceChildren(
      ...tracks.map((t) => {
        const opt = document.createElement('option');
        opt.textContent = t.kind === 'asr' ? `${t.label} (auto)` : t.label;
        return opt;
      }),
    );
    this.selectEl.selectedIndex = selectedIndex;
    this.selectEl.hidden = tracks.length === 0;
  }

  setCues(cues: SubtitleCue[]): void {
    this.cancelCaptureEditor();
    this.cues = cues;
    this.copyEl.disabled = cues.length === 0;
    this.copyEl.title = cues.length === 0 ? 'No subtitles to copy' : 'Copy all subtitles';
    this.activeIndex = -1;
    this.hideChip();
    this.rows = cues.map((cue, i) => {
      const row = document.createElement('div');
      row.className = 'm2-row';

      const time = document.createElement('button');
      time.className = 'm2-time';
      time.textContent = formatTime(cue.start);
      time.title = 'Jump here';
      time.addEventListener('click', () => this.onSeek?.(cue.start));

      const text = document.createElement('div');
      text.className = 'm2-text';
      text.textContent = cue.text;
      // Seek on text click too, but never when the user is selecting text
      // (selection across rows is how multi-line mining works).
      text.addEventListener('click', () => {
        if (window.getSelection()?.isCollapsed) this.onSeek?.(cue.start);
      });

      const add = document.createElement('button');
      add.className = 'm2-add';
      add.textContent = '＋';
      add.title = 'Add audio + screenshot to the last mined Anki card\nAlt+click: new Basic card';
      add.addEventListener('click', (e) => {
        const selText = window.getSelection()?.toString().trim() ?? '';
        this.onMine?.({
          from: i,
          to: i,
          mode: e.altKey ? 'basic' : 'update',
          selText,
          adjust: false,
        });
      });

      row.append(time, text, add);
      row.dataset.i = String(i);
      return row;
    });
    this.listEl.replaceChildren(...this.rows);
  }

  setStatus(message: string | null, withRetry = false): void {
    this.statusEl.hidden = message === null;
    this.statusEl.replaceChildren();
    if (message === null) return;
    this.statusEl.append(message);
    if (withRetry) {
      const retry = document.createElement('button');
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => this.onRetry?.());
      this.statusEl.append(retry);
    }
  }

  /** Highlight the most recently started cue at time t (ms); optionally keep
   * it vertically centered. Deliberately ignores cue end: during inter-line
   * gaps (common in ASR tracks) the line you just heard stays highlighted,
   * which is what you want when mining. */
  updateTime(tMs: number, autoscroll: boolean): void {
    let next = -1;
    for (let i = 0; i < this.cues.length; i++) {
      if (this.cues[i]!.start > tMs) break;
      next = i;
    }
    if (next === this.activeIndex) return;
    if (this.activeIndex >= 0) this.rows[this.activeIndex]?.classList.remove('m2-active');
    this.activeIndex = next;
    if (next >= 0) {
      this.rows[next]?.classList.add('m2-active');
      if (autoscroll && !this.hovering && !this.captureEditor.isOpen) this.centerRow(next);
    }
  }

  /** Index of the currently highlighted cue, or -1. */
  get activeCueIndex(): number {
    return this.activeIndex;
  }

  /** Snap the active row back to the vertical center (e.g. on play-resume). */
  recenter(): void {
    if (this.activeIndex >= 0 && !this.captureEditor.isOpen) this.centerRow(this.activeIndex);
  }

  setRowBusy(from: number, to: number, busy: boolean): void {
    for (let i = from; i <= to; i++) {
      const row = this.rows[i];
      if (!row) continue;
      row.classList.toggle('m2-busy', busy);
      const add = row.querySelector<HTMLButtonElement>('.m2-add');
      if (add) add.textContent = busy ? '…' : '＋';
    }
  }

  setVisible(visible: boolean): void {
    this.host.style.display = visible ? '' : 'none';
    if (!visible) {
      this.hideChip();
      this.cancelCaptureEditor();
    }
  }

  showCaptureEditor(options: CaptureEditorOptions): void {
    this.host.classList.add('m2-editing');
    this.captureEditor.open({
      ...options,
      onConfirm: async (draft) => {
        const shouldClose = await options.onConfirm(draft);
        if (shouldClose) this.host.classList.remove('m2-editing');
        return shouldClose;
      },
      onCancel: () => {
        this.host.classList.remove('m2-editing');
        options.onCancel();
      },
    });
  }

  closeCaptureEditor(): void {
    this.captureEditor.close();
    this.host.classList.remove('m2-editing');
  }

  cancelCaptureEditor(): void {
    if (this.captureEditor.isOpen) this.captureEditor.cancel();
  }

  private centerRow(i: number): void {
    const row = this.rows[i];
    if (!row) return;
    // offsetTop is relative to .m2-list (position: relative).
    const top = row.offsetTop - this.listEl.clientHeight / 2 + row.offsetHeight / 2;
    this.listEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  private async copySubtitles(): Promise<void> {
    const text = this.cues
      .map((cue) => cue.text.replace(/[\r\n]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (!text) return;

    try {
      await writeClipboard(text);
      window.clearTimeout(this.copyResetTimeout);
      this.copyEl.textContent = '✓';
      this.copyResetTimeout = window.setTimeout(() => {
        this.copyEl.textContent = '📋';
      }, 1500);
      showToast(`Copied ${this.cues.length} subtitle lines`);
    } catch {
      showToast('Could not copy subtitles to the clipboard.', 'error');
    }
  }

  private updateChip(): void {
    const span = this.selectionSpan();
    if (!span) {
      this.hideChip();
      return;
    }
    const sel = window.getSelection();
    const rect = sel!.getRangeAt(0).getBoundingClientRect();
    this.chipSpan = span;
    this.chipEl.textContent = '✂ Adjust & add';
    this.chipEl.title =
      span.from === span.to
        ? 'Adjust audio and screenshot timing for this selection'
        : `Adjust audio and screenshot timing for ${span.to - span.from + 1} lines`;
    this.chipEl.style.left = `${rect.left + rect.width / 2}px`;
    this.chipEl.style.top = `${rect.bottom + 8}px`;
    this.chipEl.style.display = 'block';
  }

  private hideChip(): void {
    this.chipSpan = null;
    this.chipEl.style.display = 'none';
  }

  /** Cue span and endpoint offsets for any non-empty subtitle text selection. */
  private selectionSpan(): SidebarMineRequest | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    if (sel.toString().trim().length === 0) return null;
    const range = sel.getRangeAt(0);
    const textElement = (node: Node | null): HTMLElement | null => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      const text = el?.closest<HTMLElement>('.m2-text') ?? null;
      return text && this.listEl.contains(text) ? text : null;
    };
    const startText = textElement(range.startContainer);
    const endText = textElement(range.endContainer);
    if (!startText || !endText) return null;
    const startRow = startText.closest<HTMLElement>('.m2-row');
    const endRow = endText.closest<HTMLElement>('.m2-row');
    if (!startRow || !endRow) return null;
    const from = Number(startRow.dataset.i);
    const to = Number(endRow.dataset.i);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return null;
    return {
      from,
      to,
      mode: 'update',
      selText: sel.toString().trim(),
      adjust: true,
      startOffset: offsetWithin(startText, range.startContainer, range.startOffset),
      endOffset: offsetWithin(endText, range.endContainer, range.endOffset),
    };
  }
}

async function writeClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back for browsers that expose Clipboard API but deny it to content scripts.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  Object.assign(textarea.style, {
    position: 'fixed',
    left: '-9999px',
    opacity: '0',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard copy failed');
}

function offsetWithin(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return 0;
  }
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${m}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : mmss;
}

import type { SubtitleCue } from '@migaku2/subtitles';
import type { TrackInfo } from './messages';

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
  private rows: HTMLElement[] = [];
  private cues: SubtitleCue[] = [];
  private activeIndex = -1;
  private hovering = false;
  private chipSpan: { from: number; to: number } | null = null;

  onSeek?: (ms: number) => void;
  onTrackChange?: (index: number) => void;
  onRetry?: () => void;
  /** Mine cue lines [from..to] (inclusive; from === to for a single line). */
  onMine?: (from: number, to: number) => void;

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
    header.append(title, this.selectEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'm2-status';
    this.statusEl.hidden = true;

    this.listEl = document.createElement('div');
    this.listEl.className = 'm2-list';
    this.listEl.addEventListener('mouseenter', () => (this.hovering = true));
    this.listEl.addEventListener('mouseleave', () => (this.hovering = false));

    // Floating "+ Add N lines" chip shown while a selection spans rows.
    // position: fixed escapes the host's overflow clipping.
    this.chipEl = document.createElement('button');
    this.chipEl.id = 'm2-chip';
    // Keep the selection alive: a mousedown would collapse it before click.
    this.chipEl.addEventListener('mousedown', (e) => e.preventDefault());
    this.chipEl.addEventListener('click', () => {
      const span = this.chipSpan;
      this.hideChip();
      window.getSelection()?.removeAllRanges();
      if (span) this.onMine?.(span.from, span.to);
    });
    document.addEventListener('selectionchange', () => {
      clearTimeout(this.selDebounce);
      this.selDebounce = window.setTimeout(() => this.updateChip(), 150);
    });

    this.host.append(header, this.statusEl, this.listEl, this.chipEl);
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
    this.cues = cues;
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
      add.title = 'Add audio + screenshot to the last mined Anki card';
      add.addEventListener('click', () => this.onMine?.(i, i));

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
      if (autoscroll && !this.hovering) this.centerRow(next);
    }
  }

  /** Snap the active row back to the vertical center (e.g. on play-resume). */
  recenter(): void {
    if (this.activeIndex >= 0) this.centerRow(this.activeIndex);
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
    if (!visible) this.hideChip();
  }

  private centerRow(i: number): void {
    const row = this.rows[i];
    if (!row) return;
    // offsetTop is relative to .m2-list (position: relative).
    const top = row.offsetTop - this.listEl.clientHeight / 2 + row.offsetHeight / 2;
    this.listEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
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
    this.chipEl.textContent = `＋ Add ${span.to - span.from + 1} lines`;
    this.chipEl.style.left = `${rect.left + rect.width / 2}px`;
    this.chipEl.style.top = `${rect.bottom + 8}px`;
    this.chipEl.style.display = 'block';
  }

  private hideChip(): void {
    this.chipSpan = null;
    this.chipEl.style.display = 'none';
  }

  /** Row span of the current text selection, if it covers 2+ rows in the list. */
  private selectionSpan(): { from: number; to: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rowIndex = (node: Node | null): number => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      const row = el?.closest<HTMLElement>('.m2-row');
      if (!row || !this.listEl.contains(row)) return -1;
      return Number(row.dataset.i);
    };
    const a = rowIndex(range.startContainer);
    const b = rowIndex(range.endContainer);
    if (a < 0 || b < 0 || a === b) return null;
    return { from: Math.min(a, b), to: Math.max(a, b) };
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

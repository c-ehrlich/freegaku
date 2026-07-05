import type { SubtitleCue } from '@migaku2/subtitles';
import type { TrackInfo } from './messages';

// Plain DOM, no shadow root: Yomitan must be able to scan the subtitle text,
// and shadow-root piercing is not something we can rely on. All styles are
// namespaced under #m2-sidebar and scoped with high-specificity selectors.

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
  font-size: 16px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: inherit;
}
`;

export class Sidebar {
  readonly host: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly selectEl: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private rows: HTMLElement[] = [];
  private cues: SubtitleCue[] = [];
  private activeIndex = -1;
  private hovering = false;

  onSeek?: (ms: number) => void;
  onTrackChange?: (index: number) => void;
  onRetry?: () => void;

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

    this.host.append(header, this.statusEl, this.listEl);
  }

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
      // (selection is how multi-line mining will work later).
      text.addEventListener('click', () => {
        if (window.getSelection()?.isCollapsed) this.onSeek?.(cue.start);
      });

      row.append(time, text);
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

  /** Highlight + autoscroll to the most recently started cue at time t (ms).
   * Deliberately ignores cue end: during inter-line gaps (common in ASR
   * tracks) the line you just heard stays highlighted, which is what you
   * want when mining. */
  updateTime(tMs: number): void {
    let next = -1;
    for (let i = 0; i < this.cues.length; i++) {
      if (this.cues[i]!.start > tMs) break;
      next = i;
    }
    if (next === this.activeIndex) return;
    if (this.activeIndex >= 0) this.rows[this.activeIndex]?.classList.remove('m2-active');
    this.activeIndex = next;
    if (next >= 0) {
      const row = this.rows[next];
      row?.classList.add('m2-active');
      if (!this.hovering) row?.scrollIntoView({ block: 'nearest' });
    }
  }

  setVisible(visible: boolean): void {
    this.host.style.display = visible ? '' : 'none';
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

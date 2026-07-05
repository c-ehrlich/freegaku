// Current-line subtitle overlay rendered inside #movie_player. Plain DOM so
// Yomitan can scan it. Text is selectable; the wrapper ignores pointer events
// so player clicks still work everywhere else.
const CSS = `
#m2-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 9%;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 58; /* above video, below YouTube's control bar */
}
#m2-overlay .m2-overlay-text {
  pointer-events: auto;
  user-select: text;
  max-width: 86%;
  background: rgba(8, 8, 8, 0.75);
  color: #fff;
  font-family: "Roboto", "Noto Sans JP", sans-serif;
  font-size: clamp(16px, 2.4vw, 42px);
  line-height: 1.45;
  padding: 3px 14px;
  border-radius: 8px;
  text-align: center;
  white-space: pre-wrap;
}
`;

export class Overlay {
  readonly host: HTMLElement;
  private readonly textEl: HTMLElement;
  private enabled = true;
  private currentText: string | null = null;

  constructor() {
    this.host = document.createElement('div');
    this.host.id = 'm2-overlay';
    const style = document.createElement('style');
    style.textContent = CSS;
    this.textEl = document.createElement('span');
    this.textEl.className = 'm2-overlay-text';
    this.host.append(style, this.textEl);
    this.host.style.display = 'none';
  }

  /** (Re)attach inside the player element; survives fullscreen and theater. */
  mount(player: HTMLElement): void {
    if (this.host.parentElement !== player) player.append(this.host);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.render();
  }

  setText(text: string | null): void {
    if (text === this.currentText) return;
    this.currentText = text;
    this.render();
  }

  private render(): void {
    const show = this.enabled && this.currentText !== null;
    this.host.style.display = show ? '' : 'none';
    if (show) this.textEl.textContent = this.currentText;
  }
}

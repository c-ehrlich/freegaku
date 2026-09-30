import { formatCost } from './explain';
import type { ExplainStream } from './explain-client';
import { guardFocus, isolateKeys } from './focus-guard';
import { streamExplanation } from './explain-client';
import { renderMarkdown } from './markdown';
import type { ExplainContext, ExplainResult, ExplainTurn } from './messages';

export interface ExplainPanelOptions {
  context: ExplainContext;
  onClose: () => void;
}

// Docked at the bottom of the sidebar like the capture editor, with the same
// visual language. Plain DOM (no shadow root) so Yomitan can scan answers.
const CSS = `
#m2-sidebar .m2-explain-panel {
  --m2-explain-accent: #3ea6ff;
  --m2-explain-ink: #0f0f0f;
  --m2-explain-muted: #606060;
  --m2-explain-panel: rgba(255, 255, 255, 0.86);
  --m2-explain-soft: rgba(15, 15, 15, 0.06);
  display: none;
  flex: none;
  padding: 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.28);
  background: var(--m2-explain-panel);
  color: var(--m2-explain-ink);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(14px);
}
html[dark] #m2-sidebar .m2-explain-panel,
#m2-sidebar.m2-nf .m2-explain-panel {
  --m2-explain-ink: #f1f1f1;
  --m2-explain-muted: #aaa;
  --m2-explain-panel: rgba(20, 20, 20, 0.94);
  --m2-explain-soft: rgba(255, 255, 255, 0.07);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.24);
}
#m2-sidebar .m2-explain-panel.m2-open {
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: m2-explain-in 140ms ease-out;
}
@keyframes m2-explain-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
#m2-sidebar .m2-explain-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#m2-sidebar .m2-explain-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
#m2-sidebar .m2-explain-lines,
#m2-sidebar .m2-explain-cost {
  color: var(--m2-explain-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
#m2-sidebar .m2-explain-heading .m2-explain-lines {
  flex: 1;
}
#m2-sidebar .m2-explain-quote {
  margin: 0;
  padding: 6px 9px;
  border-left: 3px solid var(--m2-explain-accent);
  border-radius: 4px;
  background: var(--m2-explain-soft);
  font-size: 13px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  user-select: text;
  -webkit-user-select: text;
}
#m2-sidebar .m2-explain-thread {
  max-height: min(42vh, 380px);
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.55;
  user-select: text;
  -webkit-user-select: text;
}
#m2-sidebar .m2-explain-thread:empty {
  display: none;
}
#m2-sidebar .m2-explain-question {
  margin: 10px 0 4px;
  color: var(--m2-explain-muted);
  font-size: 12px;
  font-weight: 600;
  white-space: pre-wrap;
}
#m2-sidebar .m2-explain-question:first-child {
  margin-top: 0;
}
#m2-sidebar .m2-explain-answer p,
#m2-sidebar .m2-explain-answer ul,
#m2-sidebar .m2-explain-answer ol,
#m2-sidebar .m2-explain-answer h4 {
  margin: 0 0 7px;
}
#m2-sidebar .m2-explain-answer ul,
#m2-sidebar .m2-explain-answer ol {
  padding-left: 20px;
}
#m2-sidebar .m2-explain-answer h4 {
  font-size: 13px;
}
#m2-sidebar .m2-explain-answer code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--m2-explain-soft);
  font-size: 12px;
}
#m2-sidebar .m2-explain-answer.m2-pending::after {
  content: '▍';
  color: var(--m2-explain-accent);
  animation: m2-explain-blink 1s steps(2) infinite;
}
@keyframes m2-explain-blink {
  50% { opacity: 0; }
}
#m2-sidebar .m2-explain-error {
  font-size: 12px;
  color: #e5484d;
}
#m2-sidebar .m2-explain-error button {
  margin-left: 6px;
  border: none;
  background: none;
  color: var(--m2-explain-accent);
  font: inherit;
  cursor: pointer;
  padding: 0;
}
#m2-sidebar .m2-explain-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 52px;
  max-height: 140px;
  resize: vertical;
  padding: 7px 9px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
}
#m2-sidebar .m2-explain-input:focus {
  outline: none;
  border-color: var(--m2-explain-accent);
}
#m2-sidebar .m2-explain-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
#m2-sidebar .m2-explain-actions .m2-explain-spacer {
  flex: 1;
}
#m2-sidebar .m2-explain-button,
#m2-sidebar .m2-explain-close {
  border: none;
  cursor: pointer;
  font-family: inherit;
}
#m2-sidebar .m2-explain-button {
  padding: 7px 11px;
  border-radius: 7px;
  background: transparent;
  color: var(--m2-explain-muted);
  font-size: 12px;
  font-weight: 500;
}
#m2-sidebar .m2-explain-button:hover:not(:disabled) {
  background: rgba(128, 128, 128, 0.14);
}
#m2-sidebar .m2-explain-button:disabled {
  cursor: default;
  opacity: 0.45;
}
#m2-sidebar .m2-explain-button.m2-primary {
  background: var(--m2-explain-accent);
  color: #fff;
}
#m2-sidebar .m2-explain-button.m2-primary:hover:not(:disabled) {
  background: #2d96eb;
}
#m2-sidebar .m2-explain-close {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: transparent;
  color: var(--m2-explain-muted);
  font-size: 18px;
  line-height: 1;
  padding: 0;
}
#m2-sidebar .m2-explain-close:hover {
  background: rgba(128, 128, 128, 0.14);
}
`;

type Phase = 'asking' | 'streaming' | 'answered';

export class ExplainPanel {
  readonly host: HTMLElement;
  private readonly linesEl: HTMLElement;
  private readonly quoteEl: HTMLElement;
  private readonly threadEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly inputEl: HTMLTextAreaElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly costEl: HTMLElement;
  private readonly secondaryButton: HTMLButtonElement;
  private readonly primaryButton: HTMLButtonElement;
  private options: ExplainPanelOptions | null = null;
  private history: ExplainTurn[] = [];
  private stream: ExplainStream | null = null;
  private phase: Phase = 'asking';
  private totalCost: number | null = null;

  constructor() {
    this.host = element('section', 'm2-explain-panel');
    this.host.setAttribute('aria-label', 'Explain selection');
    const style = document.createElement('style');
    style.textContent = CSS;

    const heading = element('div', 'm2-explain-heading');
    const close = button('m2-explain-close', '×', 'Close');
    close.addEventListener('click', () => this.cancel());
    heading.append(
      element('span', 'm2-explain-title', '💡 Explain'),
      (this.linesEl = element('span', 'm2-explain-lines')),
      close,
    );

    this.quoteEl = element('blockquote', 'm2-explain-quote');
    this.threadEl = element('div', 'm2-explain-thread');
    this.errorEl = element('div', 'm2-explain-error');
    this.errorEl.hidden = true;

    this.inputEl = element('textarea', 'm2-explain-input');
    this.inputEl.rows = 2;
    this.inputEl.addEventListener('input', () => this.renderActions());

    const actions = element('div', 'm2-explain-actions');
    this.copyButton = button('m2-explain-button', 'Copy', 'Copy the latest answer');
    this.copyButton.addEventListener('click', () => void this.copyLatest());
    this.costEl = element('span', 'm2-explain-cost');
    this.secondaryButton = button('m2-explain-button', 'Cancel');
    this.secondaryButton.addEventListener('click', () => this.cancel());
    this.primaryButton = button('m2-explain-button m2-primary', 'Explain');
    this.primaryButton.addEventListener('click', () => this.onPrimary());
    actions.append(
      this.copyButton,
      this.costEl,
      element('span', 'm2-explain-spacer'),
      this.secondaryButton,
      this.primaryButton,
    );

    this.host.append(style, heading, this.quoteEl, this.threadEl, this.errorEl, this.inputEl, actions);
    // Keep site hotkeys (space = play/pause) away from typing, and the
    // question box focused when Netflix moves focus to its player.
    isolateKeys(this.host);
    guardFocus(this.inputEl, () => this.isOpen);
    this.host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.cancel();
      else if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        event.target === this.inputEl
      ) {
        event.preventDefault();
        if (this.phase !== 'streaming') this.onPrimary();
      }
    });
  }

  get isOpen(): boolean {
    return this.options !== null;
  }

  open(options: ExplainPanelOptions): void {
    if (this.options) this.close();
    this.options = options;
    this.history = [];
    this.totalCost = null;
    const count = options.context.to - options.context.from + 1;
    this.linesEl.textContent = count === 1 ? '1 selected line' : `${count} selected lines`;
    this.quoteEl.textContent = options.context.selectedText;
    this.threadEl.replaceChildren();
    this.setError(null);
    this.inputEl.value = '';
    this.setPhase('asking');
    this.host.classList.add('m2-open');
    this.inputEl.focus();
  }

  /** Close and notify the owner (Escape, ×, Cancel/Close). */
  cancel(): void {
    const options = this.options;
    if (!options) return;
    this.close();
    options.onClose();
  }

  /** Close without notifying; stops any running generation. */
  close(): void {
    this.stream?.cancel();
    this.stream = null;
    this.options = null;
    this.history = [];
    this.host.classList.remove('m2-open');
  }

  private onPrimary(): void {
    if (this.phase === 'streaming') {
      this.stream?.cancel();
      return;
    }
    void this.ask();
  }

  private async ask(): Promise<void> {
    const options = this.options;
    if (!options) return;
    const question = this.inputEl.value.trim();
    if (this.phase === 'answered' && !question) return;
    this.setError(null);

    if (question) this.threadEl.append(element('div', 'm2-explain-question', question));
    const answerEl = element('div', 'm2-explain-answer m2-pending');
    this.threadEl.append(answerEl);
    this.inputEl.value = '';
    this.setPhase('streaming');

    let text = '';
    let frame = 0;
    const stickToBottom = (): void => {
      const t = this.threadEl;
      if (t.scrollHeight - t.scrollTop - t.clientHeight < 60) t.scrollTop = t.scrollHeight;
    };
    const stream = streamExplanation(
      { context: options.context, history: this.history, question },
      (delta) => {
        text += delta;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          answerEl.replaceChildren(renderMarkdown(text));
          stickToBottom();
        });
      },
    );
    this.stream = stream;
    const result: ExplainResult = await stream.result;
    cancelAnimationFrame(frame);
    if (this.options !== options || this.stream !== stream) return; // closed or superseded
    this.stream = null;
    answerEl.classList.remove('m2-pending');

    if (result.ok) {
      text = result.text;
      if (result.costUsd !== null) this.totalCost = (this.totalCost ?? 0) + result.costUsd;
    }
    if (result.ok || (result.error === 'Cancelled' && text)) {
      // A stopped answer stays in the thread so follow-ups can build on it.
      answerEl.replaceChildren(renderMarkdown(text));
      this.history.push({ question, answer: text });
      this.setPhase('answered');
    } else {
      answerEl.remove();
      if (question) this.threadEl.lastElementChild?.remove();
      this.inputEl.value = question;
      if (result.error !== 'Cancelled') this.setError(result.error, !result.ok && result.code === 'no-key');
      this.setPhase(this.history.length ? 'answered' : 'asking');
    }
    stickToBottom();
    this.inputEl.focus();
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.inputEl.placeholder =
      phase === 'asking' ? 'What would you like explained? (optional)' : 'Ask a follow-up…';
    this.renderActions();
  }

  private renderActions(): void {
    const answered = this.history.length > 0;
    this.copyButton.hidden = !answered || this.phase === 'streaming';
    this.costEl.textContent = this.totalCost !== null ? formatCost(this.totalCost) : '';
    this.costEl.title = this.totalCost !== null ? 'OpenRouter cost of this explanation' : '';
    this.secondaryButton.textContent = answered ? 'Close' : 'Cancel';
    this.secondaryButton.hidden = this.phase === 'streaming';
    this.primaryButton.textContent =
      this.phase === 'streaming' ? 'Stop' : this.phase === 'answered' ? 'Ask' : 'Explain';
    this.primaryButton.disabled = this.phase === 'answered' && !this.inputEl.value.trim();
  }

  private setError(message: string | null, withSettings = false): void {
    this.errorEl.hidden = message === null;
    this.errorEl.replaceChildren();
    if (message === null) return;
    this.errorEl.append(message);
    if (withSettings) {
      const open = button('', 'Open settings');
      open.addEventListener('click', () => {
        void browser.runtime.sendMessage({ type: 'm2-open-settings' });
      });
      this.errorEl.append(open);
    }
  }

  private async copyLatest(): Promise<void> {
    const latest = this.history[this.history.length - 1];
    if (!latest) return;
    try {
      await navigator.clipboard.writeText(latest.answer);
      this.copyButton.textContent = 'Copied ✓';
    } catch {
      this.copyButton.textContent = 'Copy failed';
    }
    setTimeout(() => (this.copyButton.textContent = 'Copy'), 1500);
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

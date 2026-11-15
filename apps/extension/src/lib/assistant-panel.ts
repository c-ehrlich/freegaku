import { formatCost } from './assistant';
import type { AssistantStream } from './assistant-client';
import { streamAssistant } from './assistant-client';
import { guardFocus, isolateKeys } from './focus-guard';
import { renderMarkdown } from './markdown';
import { icon, setButtonContent } from './ui/icons';
import type { IconName } from './ui/icons';
import type { AssistantPortClientMessage, AssistantResult, AssistantTurn } from './messages';

// Docked at the bottom of the sidebar like the capture editor, with the same
// visual language. Plain DOM (no shadow root) so Yomitan can scan answers.
const CSS = `
#m2-sidebar .m2-assistant-panel {
  display: none;
  flex: none;
  padding: 12px;
  border-top: 1px solid var(--m2-border);
  background: var(--m2-bg);
}
#m2-sidebar .m2-assistant-panel.m2-open {
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: m2-panel-in 140ms ease-out;
}
@keyframes m2-panel-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
#m2-sidebar .m2-assistant-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -2px -4px 0 0;
}
#m2-sidebar .m2-assistant-heading > .m2-icon {
  color: var(--m2-primary);
}
#m2-sidebar .m2-assistant-title {
  font-size: 13px;
  font-weight: 600;
}
#m2-sidebar .m2-assistant-lines,
#m2-sidebar .m2-assistant-cost {
  color: var(--m2-muted-fg);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
#m2-sidebar .m2-assistant-heading .m2-assistant-lines {
  flex: 1;
}
#m2-sidebar .m2-assistant-quote {
  margin: 0;
  padding: 7px 10px;
  border-left: 3px solid var(--m2-primary);
  border-radius: 4px var(--m2-radius-sm) var(--m2-radius-sm) 4px;
  background: var(--m2-muted);
  font-family: var(--m2-font-cue);
  font-size: 14px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  user-select: text;
  -webkit-user-select: text;
}
/* A fixed height, so streaming fills the space instead of growing the panel. */
#m2-sidebar .m2-assistant-thread {
  height: min(42vh, 380px);
  overflow-y: auto;
  font-size: 13.5px;
  line-height: 1.6;
  user-select: text;
  -webkit-user-select: text;
  scrollbar-width: thin;
  scrollbar-color: var(--m2-input) transparent;
}
#m2-sidebar .m2-assistant-thread:empty {
  display: none;
}
#m2-sidebar .m2-assistant-question {
  width: fit-content;
  max-width: 85%;
  margin: 14px 0 10px auto;
  padding: 6px 11px;
  border-radius: var(--m2-radius-sm);
  background: var(--m2-primary-soft);
  font-size: 13px;
  font-weight: 500;
  white-space: pre-wrap;
}
#m2-sidebar .m2-assistant-question:first-child {
  margin-top: 0;
}
#m2-sidebar .m2-assistant-answer p,
#m2-sidebar .m2-assistant-answer ul,
#m2-sidebar .m2-assistant-answer ol,
#m2-sidebar .m2-assistant-answer h4 {
  margin: 0 0 8px;
}
#m2-sidebar .m2-assistant-answer ul,
#m2-sidebar .m2-assistant-answer ol {
  padding-left: 18px;
}
#m2-sidebar .m2-assistant-answer li {
  margin-bottom: 3px;
}
#m2-sidebar .m2-assistant-answer li::marker {
  color: var(--m2-muted-fg);
}
#m2-sidebar .m2-assistant-answer h4 {
  margin-top: 12px;
  font-size: var(--m2-label-size);
  text-transform: var(--m2-label-transform);
  letter-spacing: var(--m2-label-tracking);
  color: var(--m2-muted-fg);
}
#m2-sidebar .m2-assistant-answer h4:first-child {
  margin-top: 0;
}
#m2-sidebar .m2-assistant-answer strong {
  font-weight: 600;
}
#m2-sidebar .m2-assistant-answer code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--m2-muted);
  font-family: var(--m2-font-mono);
  font-size: 12px;
}
#m2-sidebar .m2-assistant-answer.m2-pending::after {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-left: 4px;
  border-radius: 50%;
  background: var(--m2-primary);
  vertical-align: middle;
  animation: m2-assistant-pulse 1s ease-in-out infinite;
}
@keyframes m2-assistant-pulse {
  50% { opacity: 0.25; transform: scale(0.8); }
}
#m2-sidebar .m2-assistant-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--m2-radius-sm);
  background: color-mix(in srgb, var(--m2-danger) 12%, transparent);
  color: var(--m2-danger);
  font-size: 12.5px;
}
#m2-sidebar .m2-assistant-panel .m2-assistant-error .m2-btn {
  height: 24px;
  margin-left: auto;
  padding: 0 8px;
  color: inherit;
}
#m2-sidebar .m2-assistant-input {
  min-height: 40px;
  max-height: 140px;
  resize: none;
  field-sizing: content;
}
#m2-sidebar .m2-assistant-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
#m2-sidebar .m2-assistant-actions .m2-assistant-spacer {
  flex: 1;
}
#m2-sidebar .m2-assistant-cost {
  margin-left: 4px;
}
#m2-sidebar .m2-assistant-notice {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--m2-radius-sm);
  background: var(--m2-warn-soft);
  color: var(--m2-fg);
  font-size: 12.5px;
  line-height: 1.45;
}
#m2-sidebar .m2-assistant-notice .m2-icon {
  margin-top: 1px;
  color: var(--m2-warn);
}
#m2-sidebar .m2-assistant-choice p {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.55;
}
#m2-sidebar .m2-assistant-choice .m2-assistant-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}
#m2-sidebar .m2-assistant-panel .m2-btn {
  height: 32px;
  font-size: 13px;
}
`;

type Phase = 'asking' | 'streaming' | 'answered';

export interface AssistantPanelOptions {
  /** Heading, e.g. 'Explain'. */
  title: string;
  icon?: IconName;
  /** Muted text next to the heading. */
  meta?: string;
  /** Quoted text under the heading (the selection being explained). */
  quote?: string;
  /** Warning shown above the answers. */
  notice?: string;
  /** Asks the learner to pick before anything is sent; nothing else is shown. */
  choice?: { message: string; options: Array<{ label: string; primary?: boolean; pick: () => void }> };
  /** Wait for an optional question before the first answer. Without it the
   * first answer starts on open. */
  ask?: { label: string; placeholder: string };
  /** Offer ↻ Regenerate once answered. */
  regenerate?: boolean;
  /** Earlier turns (and their cost) to show again. */
  history?: AssistantTurn[];
  totalCost?: number | null;
  /** The port message for the next answer; absent while a choice is shown. */
  start?: (history: AssistantTurn[], question: string) => AssistantPortClientMessage;
  /** The thread after each finished answer and on Regenerate. */
  onThread?: (history: AssistantTurn[], totalCost: number | null) => void;
  onClose: () => void;
}

export class AssistantPanel {
  readonly host: HTMLElement;
  private readonly titleEl: HTMLElement;
  private iconEl: Element;
  private readonly metaEl: HTMLElement;
  private readonly quoteEl: HTMLElement;
  private readonly noticeEl: HTMLElement;
  private readonly choiceEl: HTMLElement;
  private readonly threadEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly inputEl: HTMLTextAreaElement;
  private readonly actionsEl: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly costEl: HTMLElement;
  private readonly regenerateButton: HTMLButtonElement;
  private readonly secondaryButton: HTMLButtonElement;
  private readonly primaryButton: HTMLButtonElement;
  private options: AssistantPanelOptions | null = null;
  private history: AssistantTurn[] = [];
  private stream: AssistantStream | null = null;
  private phase: Phase = 'asking';
  private totalCost: number | null = null;

  constructor() {
    this.host = element('section', 'm2-assistant-panel');
    const style = document.createElement('style');
    style.textContent = CSS;

    const heading = element('div', 'm2-assistant-heading');
    const close = button('m2-icon-btn m2-assistant-close', '', 'Close');
    close.append(icon('x'));
    close.addEventListener('click', () => this.cancel());
    heading.append(
      (this.iconEl = element('span')),
      (this.titleEl = element('span', 'm2-assistant-title')),
      (this.metaEl = element('span', 'm2-assistant-lines')),
      close,
    );

    this.quoteEl = element('blockquote', 'm2-assistant-quote');
    this.noticeEl = element('div', 'm2-assistant-notice');
    this.choiceEl = element('div', 'm2-assistant-choice');
    this.threadEl = element('div', 'm2-assistant-thread');
    this.errorEl = element('div', 'm2-assistant-error');
    this.errorEl.hidden = true;

    this.inputEl = element('textarea', 'm2-textarea m2-assistant-input');
    this.inputEl.rows = 1;
    this.inputEl.addEventListener('input', () => this.renderActions());

    this.actionsEl = element('div', 'm2-assistant-actions');
    this.copyButton = button('m2-icon-btn', '', 'Copy the latest answer');
    setButtonContent(this.copyButton, 'copy');
    this.copyButton.addEventListener('click', () => void this.copyLatest());
    this.costEl = element('span', 'm2-assistant-cost');
    this.regenerateButton = button('m2-icon-btn', '', 'Regenerate: write it again from scratch');
    setButtonContent(this.regenerateButton, 'rotate');
    this.regenerateButton.addEventListener('click', () => this.regenerate());
    this.secondaryButton = button('m2-btn m2-muted', 'Cancel');
    this.secondaryButton.addEventListener('click', () => this.cancel());
    this.primaryButton = button('m2-btn m2-primary', '');
    this.primaryButton.addEventListener('click', () => this.onPrimary());
    this.actionsEl.append(
      this.copyButton,
      this.regenerateButton,
      this.costEl,
      element('span', 'm2-assistant-spacer'),
      this.secondaryButton,
      this.primaryButton,
    );

    this.host.append(
      style,
      heading,
      this.quoteEl,
      this.noticeEl,
      this.choiceEl,
      this.threadEl,
      this.errorEl,
      this.inputEl,
      this.actionsEl,
    );
    // Keep site hotkeys (space = play/pause) away from typing, and the
    // question box focused when Netflix moves focus to its player.
    isolateKeys(this.host);
    guardFocus(this.inputEl, () => this.isOpen && !this.inputEl.hidden);
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

  open(options: AssistantPanelOptions): void {
    if (this.options) this.close();
    this.options = options;
    this.history = [...(options.history ?? [])];
    this.totalCost = options.totalCost ?? null;
    this.host.setAttribute('aria-label', options.title);
    this.titleEl.textContent = options.title;
    const nextIcon = options.icon ? icon(options.icon) : element('span');
    this.iconEl.replaceWith(nextIcon);
    this.iconEl = nextIcon;
    this.metaEl.textContent = options.meta ?? '';
    this.quoteEl.textContent = options.quote ?? '';
    this.quoteEl.hidden = !options.quote;
    this.noticeEl.replaceChildren(icon('alert'), element('span', '', options.notice ?? ''));
    this.noticeEl.hidden = !options.notice;
    this.renderChoice(options.choice);
    this.threadEl.replaceChildren();
    for (const turn of this.history) this.appendTurn(turn);
    this.setError(null);
    this.inputEl.value = '';
    this.setPhase(this.history.length ? 'answered' : 'asking');
    this.host.classList.add('m2-open');
    if (options.choice) this.choiceEl.querySelector<HTMLButtonElement>('.m2-primary')?.focus();
    else if (!options.ask && !this.history.length) void this.ask();
    else this.inputEl.focus();
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

  private regenerate(): void {
    const options = this.options;
    if (!options || this.phase === 'streaming') return;
    this.history = [];
    this.totalCost = null;
    this.threadEl.replaceChildren();
    this.inputEl.value = '';
    options.onThread?.([], null);
    this.setPhase('asking');
    void this.ask();
  }

  private async ask(): Promise<void> {
    const options = this.options;
    if (!options?.start) return;
    const start = options.start;
    const question = this.inputEl.value.trim();
    if (this.phase === 'answered' && !question) return;
    this.setError(null);

    if (question) this.threadEl.append(element('div', 'm2-assistant-question', question));
    const answerEl = element('div', 'm2-assistant-answer m2-pending');
    this.threadEl.append(answerEl);
    this.inputEl.value = '';
    this.setPhase('streaming');

    let text = '';
    let frame = 0;
    const stickToBottom = (): void => {
      const t = this.threadEl;
      if (t.scrollHeight - t.scrollTop - t.clientHeight < 60) t.scrollTop = t.scrollHeight;
    };
    const stream = streamAssistant(start(this.history, question), (delta) => {
      text += delta;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        answerEl.replaceChildren(renderMarkdown(text));
        stickToBottom();
      });
    });
    this.stream = stream;
    const result: AssistantResult = await stream.result;
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
      options.onThread?.([...this.history], this.totalCost);
      this.setPhase('answered');
    } else {
      answerEl.remove();
      if (question) this.threadEl.lastElementChild?.remove();
      this.inputEl.value = question;
      if (result.error !== 'Cancelled') this.setError(result.error, !result.ok && result.code === 'no-key');
      this.setPhase(this.history.length ? 'answered' : 'asking');
    }
    stickToBottom();
    if (!this.inputEl.hidden) this.inputEl.focus();
  }

  private appendTurn(turn: AssistantTurn): void {
    if (turn.question) this.threadEl.append(element('div', 'm2-assistant-question', turn.question));
    const answerEl = element('div', 'm2-assistant-answer');
    answerEl.append(renderMarkdown(turn.answer));
    this.threadEl.append(answerEl);
  }

  private renderChoice(choice: AssistantPanelOptions['choice']): void {
    this.choiceEl.replaceChildren();
    this.choiceEl.hidden = !choice;
    if (!choice) return;
    const buttons = element('div', 'm2-assistant-actions');
    buttons.append(element('span', 'm2-assistant-spacer'));
    for (const option of choice.options) {
      const b = button(`m2-btn ${option.primary ? 'm2-primary' : 'm2-muted'}`, option.label);
      b.addEventListener('click', () => option.pick());
      buttons.append(b);
    }
    this.choiceEl.append(element('p', '', choice.message), buttons);
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    const ask = this.options?.ask;
    this.inputEl.placeholder = phase === 'asking' && ask ? ask.placeholder : 'Ask a follow-up…';
    this.renderActions();
  }

  private renderActions(): void {
    const options = this.options;
    const choosing = Boolean(options?.choice);
    const answered = this.history.length > 0;
    this.threadEl.hidden = choosing;
    // Without an ask step there is nothing to type until the first answer.
    this.inputEl.hidden = choosing || (!options?.ask && !answered);
    this.actionsEl.hidden = choosing;
    this.copyButton.hidden = !answered || this.phase === 'streaming';
    this.costEl.textContent = this.totalCost !== null ? formatCost(this.totalCost) : '';
    this.costEl.title = this.totalCost !== null ? 'OpenRouter cost so far' : '';
    this.regenerateButton.hidden = !options?.regenerate || !answered || this.phase === 'streaming';
    this.secondaryButton.textContent = answered ? 'Close' : 'Cancel';
    this.secondaryButton.hidden = this.phase === 'streaming';
    if (this.phase === 'streaming') setButtonContent(this.primaryButton, 'stop', 'Stop');
    else if (this.phase === 'answered') setButtonContent(this.primaryButton, 'arrowUp', 'Ask');
    else setButtonContent(this.primaryButton, null, options?.ask?.label ?? 'Retry');
    this.primaryButton.disabled = this.phase === 'answered' && !this.inputEl.value.trim();
  }

  private setError(message: string | null, withSettings = false): void {
    this.errorEl.hidden = message === null;
    this.errorEl.replaceChildren();
    if (message === null) return;
    this.errorEl.append(icon('circleAlert'), message);
    if (withSettings) {
      const open = button('m2-btn m2-outline', 'Open settings');
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
      setButtonContent(this.copyButton, 'check');
      this.copyButton.title = 'Copied';
    } catch {
      setButtonContent(this.copyButton, 'circleAlert');
      this.copyButton.title = 'Copy failed';
    }
    setTimeout(() => {
      setButtonContent(this.copyButton, 'copy');
      this.copyButton.title = 'Copy the latest answer';
    }, 1500);
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

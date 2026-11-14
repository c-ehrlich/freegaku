// Design tokens and shared primitives for every surface Freegaku draws: the
// in-page UI (plain DOM next to YouTube/Netflix, no shadow root so Yomitan can
// scan it) and the options page (shadcn/ui, which maps its theme onto these).
//
// Any element with class `m2-theme` gets the tokens. Dark applies under
// `html[dark]` (YouTube's dark mode; the options page sets it from
// prefers-color-scheme) or on `.m2-theme.m2-dark` (Netflix, always dark).
// `.m2-inverse` is the popover palette (chip, toast, prompt): dark in both themes.

const LIGHT = `
  --m2-page: #f9f9f9;
  --m2-bg: #ffffff;
  --m2-surface: rgba(0, 0, 0, 0.05);
  --m2-fg: #0f0f0f;
  --m2-muted: rgba(0, 0, 0, 0.05);
  --m2-muted-fg: #606060;
  --m2-border: rgba(0, 0, 0, 0.1);
  --m2-input: rgba(0, 0, 0, 0.2);
  --m2-hover: rgba(0, 0, 0, 0.05);
  --m2-primary: #065fd4;
  --m2-primary-fg: #ffffff;
  --m2-primary-soft: #def1ff;
  --m2-ring: rgba(6, 95, 212, 0.5);
  --m2-active: rgba(6, 95, 212, 0.08);
  --m2-active-fg: inherit;
  --m2-time: #065fd4;
  --m2-danger: #d93036;
  --m2-success: #1a7f4b;
  --m2-warn: #b26a00;
  --m2-warn-soft: rgba(255, 170, 0, 0.14);
  --m2-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.08);
`;

const DARK = `
  --m2-page: #0f0f0f;
  --m2-bg: #212121;
  --m2-surface: rgba(255, 255, 255, 0.1);
  --m2-fg: #f1f1f1;
  --m2-muted: rgba(255, 255, 255, 0.1);
  --m2-muted-fg: #aaaaaa;
  --m2-border: rgba(255, 255, 255, 0.1);
  --m2-input: rgba(255, 255, 255, 0.2);
  --m2-hover: rgba(255, 255, 255, 0.1);
  --m2-primary: #3ea6ff;
  --m2-primary-fg: #0f0f0f;
  --m2-primary-soft: #263850;
  --m2-ring: rgba(62, 166, 255, 0.5);
  --m2-active: rgba(62, 166, 255, 0.1);
  --m2-active-fg: inherit;
  --m2-time: #3ea6ff;
  --m2-danger: #ff6369;
  --m2-success: #3dd68c;
  --m2-warn: #ffb224;
  --m2-warn-soft: rgba(255, 178, 36, 0.12);
  --m2-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.4);
`;

const INVERSE = `
  --m2-bg: #222;
  --m2-surface: rgba(255, 255, 255, 0.06);
  --m2-fg: #f5f5f5;
  --m2-muted-fg: #a8a8a8;
  --m2-border: rgba(255, 255, 255, 0.12);
  --m2-input: rgba(255, 255, 255, 0.18);
  --m2-hover: rgba(255, 255, 255, 0.1);
  --m2-shadow: 0 2px 6px rgba(0, 0, 0, 0.25), 0 16px 40px rgba(0, 0, 0, 0.35);
`;

/** Shape and type: the same in both themes. */
const SHAPE = `
  --m2-font-ui: "Roboto", "YouTube Sans", system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
  --m2-font-cue: "Roboto", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  --m2-font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  --m2-font-time: var(--m2-font-ui);
  --m2-cue-size: 16px;
  --m2-cue-leading: 1.55;
  --m2-cue-weight: 400;
  --m2-radius: 12px;
  --m2-radius-sm: 8px;
  --m2-radius-btn: 18px;
  --m2-row-radius: 3px;
  --m2-active-bar: 3px;
  --m2-label-transform: none;
  --m2-label-tracking: 0;
  --m2-label-size: 12px;
`;

export const TOKENS_CSS = `
.m2-theme {${SHAPE}${LIGHT}}
html[dark] .m2-theme, .m2-theme.m2-dark {${DARK}}
.m2-theme.m2-inverse, .m2-theme .m2-inverse {${INVERSE}}
`;

/** Primitives every surface shares. Selectors stay under .m2-theme so host
 * page element styles (button { … }) lose on specificity. */
export const PRIMITIVES_CSS = `
.m2-theme {
  font-family: var(--m2-font-ui);
  color: var(--m2-fg);
  -webkit-font-smoothing: antialiased;
}
.m2-theme .m2-icon {
  width: 16px;
  height: 16px;
  flex: none;
  display: block;
}
.m2-theme .m2-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  height: 36px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: var(--m2-radius-btn);
  background: transparent;
  color: var(--m2-fg);
  font: 500 14px/1 var(--m2-font-ui);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.12s, color 0.12s, border-color 0.12s, opacity 0.12s;
}
.m2-theme .m2-btn .m2-icon {
  width: 14px;
  height: 14px;
}
.m2-theme .m2-btn:hover:not(:disabled) {
  background: var(--m2-hover);
}
.m2-theme .m2-btn:focus-visible,
.m2-theme .m2-icon-btn:focus-visible,
.m2-theme .m2-select:focus-visible {
  outline: 2px solid var(--m2-ring);
  outline-offset: 1px;
}
.m2-theme .m2-btn:disabled {
  cursor: default;
  opacity: 0.45;
}
.m2-theme .m2-btn.m2-primary {
  background: var(--m2-primary);
  color: var(--m2-primary-fg);
}
.m2-theme .m2-btn.m2-primary:hover:not(:disabled) {
  background: var(--m2-primary);
  filter: brightness(0.92);
}
.m2-theme .m2-btn.m2-outline {
  border-color: var(--m2-input);
}
.m2-theme .m2-btn.m2-muted {
  background: var(--m2-muted);
}
.m2-theme .m2-icon-btn {
  display: inline-grid;
  place-items: center;
  flex: none;
  box-sizing: border-box;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--m2-radius-btn);
  background: transparent;
  color: var(--m2-muted-fg);
  cursor: pointer;
  transition: background-color 0.12s, color 0.12s;
}
.m2-theme .m2-icon-btn:hover:not(:disabled) {
  background: var(--m2-hover);
  color: var(--m2-fg);
}
.m2-theme .m2-icon-btn:disabled {
  cursor: default;
  opacity: 0.35;
}
.m2-theme .m2-icon-btn.m2-on {
  background: var(--m2-primary-soft);
  color: var(--m2-primary);
}
.m2-theme .m2-select {
  box-sizing: border-box;
  height: 30px;
  min-width: 0;
  padding: 0 28px 0 12px;
  border: 1px solid transparent;
  border-radius: var(--m2-radius-btn);
  background: var(--m2-muted) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center / 14px;
  color: inherit;
  font: 500 12.5px/1 var(--m2-font-ui);
  text-overflow: ellipsis;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.m2-theme .m2-select:hover {
  background-color: var(--m2-hover);
}
.m2-theme .m2-select option {
  color: initial;
  background: initial;
}
.m2-theme .m2-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--m2-input);
  border-radius: var(--m2-radius-sm);
  background: transparent;
  color: inherit;
  font: 13px/1.45 var(--m2-font-ui);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.m2-theme .m2-textarea::placeholder {
  color: var(--m2-muted-fg);
}
.m2-theme .m2-textarea:focus {
  outline: none;
  border-color: var(--m2-primary);
  box-shadow: 0 0 0 3px var(--m2-primary-soft);
}
.m2-theme .m2-kbd {
  display: inline-block;
  min-width: 16px;
  padding: 1px 5px;
  border: 1px solid var(--m2-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  font: 500 10.5px/1.4 var(--m2-font-ui);
  color: var(--m2-muted-fg);
  text-align: center;
}
.m2-theme .m2-label {
  font-size: var(--m2-label-size);
  font-weight: 600;
  text-transform: var(--m2-label-transform);
  letter-spacing: var(--m2-label-tracking);
}
.m2-theme .m2-spin {
  animation: m2-spin 0.9s linear infinite;
}
@keyframes m2-spin {
  to { transform: rotate(360deg); }
}
.m2-theme [hidden] {
  display: none !important;
}
`;

let injected = false;

/** Inject tokens + primitives once per document (they outlive SPA navigations). */
export function ensureUiStyles(): void {
  if (injected && document.getElementById('m2-ui')) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'm2-ui';
  style.textContent = TOKENS_CSS + PRIMITIVES_CSS;
  (document.head ?? document.documentElement).append(style);
}

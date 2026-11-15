import { icon } from './ui/icons';
import { ensureUiStyles } from './ui/tokens';

const CSS = `
.m2-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483001;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  box-sizing: border-box;
  max-width: 380px;
  padding: 11px 14px;
  border: 1px solid var(--m2-border);
  border-radius: var(--m2-radius);
  background: var(--m2-bg);
  box-shadow: var(--m2-shadow);
  font-size: 13.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  animation: m2-toast-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.m2-toast .m2-icon {
  margin-top: 1px;
}
.m2-toast.m2-ok .m2-icon {
  color: var(--m2-success);
}
.m2-toast.m2-error .m2-icon {
  color: var(--m2-danger);
}
@keyframes m2-toast-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
`;

let currentToast: HTMLElement | null = null;
let styled = false;

export function showToast(text: string, kind: 'ok' | 'error' = 'ok'): void {
  ensureUiStyles();
  if (!styled || !document.getElementById('m2-toast-style')) {
    const style = document.createElement('style');
    style.id = 'm2-toast-style';
    style.textContent = CSS;
    (document.head ?? document.documentElement).append(style);
    styled = true;
  }
  currentToast?.remove();
  const el = document.createElement('div');
  el.className = `m2-theme m2-inverse m2-toast m2-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const message = document.createElement('span');
  message.textContent = text;
  el.append(icon(kind === 'ok' ? 'circleCheck' : 'circleAlert'), message);
  document.body.append(el);
  currentToast = el;
  setTimeout(() => {
    if (currentToast === el) currentToast = null;
    el.remove();
  }, kind === 'ok' ? 4000 : 8000);
}

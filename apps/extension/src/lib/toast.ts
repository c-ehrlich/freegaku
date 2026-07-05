let currentToast: HTMLElement | null = null;

export function showToast(text: string, kind: 'ok' | 'error' = 'ok'): void {
  currentToast?.remove();
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: '2147483001',
    maxWidth: '380px',
    padding: '10px 16px',
    borderRadius: '8px',
    fontFamily: '"Roboto", "Noto Sans JP", sans-serif',
    fontSize: '14px',
    lineHeight: '1.4',
    color: '#fff',
    background: kind === 'ok' ? 'rgba(20, 130, 70, 0.95)' : 'rgba(180, 40, 40, 0.95)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
    whiteSpace: 'pre-wrap',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(el);
  currentToast = el;
  setTimeout(() => {
    if (currentToast === el) currentToast = null;
    el.remove();
  }, kind === 'ok' ? 4000 : 8000);
}

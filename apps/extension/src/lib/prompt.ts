import { guardFocus, isolateKeys } from './focus-guard';
import { ensureUiStyles } from './ui/tokens';

/** Minimal floating input for the Basic-card Front text.
 * Resolves the entered text, or null on Escape / click-outside / empty. */
export function promptFront(prefill: string): Promise<string | null> {
  ensureUiStyles();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483002',
      background: 'rgba(0,0,0,0.35)',
    } satisfies Partial<CSSStyleDeclaration>);

    const box = document.createElement('div');
    box.className = 'm2-theme m2-inverse';
    Object.assign(box.style, {
      position: 'absolute',
      top: '20%',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '380px',
      boxSizing: 'border-box',
      background: 'var(--m2-bg)',
      border: '1px solid var(--m2-border)',
      padding: '14px',
      borderRadius: 'var(--m2-radius)',
      boxShadow: 'var(--m2-shadow)',
      fontSize: '13px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    } satisfies Partial<CSSStyleDeclaration>);

    const label = document.createElement('div');
    label.className = 'm2-label';
    label.textContent = 'New Basic card — Front';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = prefill;
    input.className = 'm2-textarea';
    Object.assign(input.style, { fontSize: '15px', fontFamily: 'var(--m2-font-cue)' });
    const hint = document.createElement('div');
    hint.style.color = 'var(--m2-muted-fg)';
    hint.style.fontSize = '11.5px';
    hint.append(kbd('Enter'), ' create  ', kbd('Esc'), ' cancel');

    box.append(label, input, hint);
    wrap.append(box);

    const finish = (value: string | null): void => {
      wrap.remove();
      resolve(value);
    };
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) finish(null);
    });
    isolateKeys(input); // keep site shortcuts out of the input
    guardFocus(input, () => input.isConnected);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) finish(input.value.trim() || null);
      else if (e.key === 'Escape') finish(null);
    });

    document.body.append(wrap);
    input.focus();
    input.select();
  });
}

function kbd(text: string): HTMLElement {
  const el = document.createElement('kbd');
  el.className = 'm2-kbd';
  el.textContent = text;
  return el;
}

/** Minimal floating input for the Basic-card Front text.
 * Resolves the entered text, or null on Escape / click-outside / empty. */
export function promptFront(prefill: string): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483002',
      background: 'rgba(0,0,0,0.25)',
    } satisfies Partial<CSSStyleDeclaration>);

    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute',
      top: '20%',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#212121',
      color: '#f1f1f1',
      padding: '14px 16px',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      fontFamily: '"Roboto", "Noto Sans JP", sans-serif',
      fontSize: '13px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>);

    const label = document.createElement('div');
    label.textContent = 'New Basic card — Front';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = prefill;
    Object.assign(input.style, {
      width: '340px',
      font: 'inherit',
      fontSize: '15px',
      color: '#f1f1f1',
      background: '#121212',
      border: '1px solid #3ea6ff',
      borderRadius: '6px',
      padding: '7px 10px',
      outline: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const hint = document.createElement('div');
    hint.textContent = 'Enter = create · Esc = cancel';
    hint.style.color = '#888';

    box.append(label, input, hint);
    wrap.append(box);

    const finish = (value: string | null): void => {
      wrap.remove();
      resolve(value);
    };
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) finish(null);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep YouTube's shortcuts out of the input
      if (e.key === 'Enter') finish(input.value.trim() || null);
      else if (e.key === 'Escape') finish(null);
    });

    document.body.append(wrap);
    input.focus();
    input.select();
  });
}

// Netflix moves focus to its player <div> on its own (mouse over the video,
// controls fading out). A space typed after that toggles playback. Take focus
// back when it leaves a text field without the user asking (click or Tab).

const USER_INTENT_MS = 400;
let lastUserIntent = 0;
let listening = false;

function noteIntent(): void {
  lastUserIntent = performance.now();
}

/** Keep `field` focused against page scripts while `active()` holds. */
export function guardFocus(field: HTMLElement, active: () => boolean): void {
  if (!listening) {
    listening = true;
    window.addEventListener('pointerdown', noteIntent, true);
    window.addEventListener('keydown', (e) => e.key === 'Tab' && noteIntent(), true);
  }
  field.addEventListener('blur', () => {
    setTimeout(() => {
      if (
        active() &&
        field.isConnected &&
        document.hasFocus() && // switching windows/apps is not theft
        document.activeElement !== field &&
        performance.now() - lastUserIntent > USER_INTENT_MS
      ) {
        field.focus({ preventScroll: true });
      }
    }, 0);
  });
}

/** Stop site shortcuts (space = play/pause) seeing keys typed in our UI. */
export function isolateKeys(root: HTMLElement): void {
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }
}

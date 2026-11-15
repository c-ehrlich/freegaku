import { ensureUiStyles } from '@/lib/ui/tokens';

/** m2 tokens on the page, dark following the OS setting live. `.m2-theme`
 * sits on <body> because the dark rules match `html[dark] .m2-theme`, which
 * <html> itself can't satisfy. Radix portals land in <body>, so they inherit. */
export function applyTheme(): void {
  ensureUiStyles();
  document.body.classList.add('m2-theme');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const sync = (): void => {
    document.documentElement.toggleAttribute('dark', dark.matches);
  };
  sync();
  dark.addEventListener('change', sync);
}

// Screenshots every lab scene with Playwright's Chromium.
//   pnpm lab:shoot                     all scenes → lab/shots/base/
//   pnpm lab:shoot --style=<name>      with lab/directions/<name>.css → lab/shots/<name>/
//   pnpm lab:shoot --only=explain      scenes whose name contains "explain"
// Each scene writes <name>.png (the page) and, for in-page scenes,
// <name>.panel.png (the sidebar alone, at 2x).
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { createServer } from 'vite';

interface Shot {
  name: string;
  path: string;
  colorScheme?: 'light' | 'dark';
  viewport?: { width: number; height: number };
  /** Runs after the scene reports ready. */
  act?: (page: Page) => Promise<void>;
  panel?: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const style = args.style as string | undefined;
const only = args.only as string | undefined;

const hoverRow = (index: number) => async (page: Page) => {
  await page.locator('#m2-sidebar .m2-row').nth(index).hover();
  await page.waitForTimeout(200);
};

const lab = (q: string) => `/index.html?${q}${style ? `&style=${style}` : ''}`;
const options = (q: string) => `/options.html?${q}${style ? `&style=${style}` : ''}`;

const SHOTS: Shot[] = [
  { name: 'yt-dark-idle', path: lab('scene=idle'), act: hoverRow(12), panel: true },
  { name: 'yt-light-idle', path: lab('scene=idle&theme=light'), act: hoverRow(12), panel: true },
  { name: 'yt-dark-chip', path: lab('scene=chip'), panel: true },
  { name: 'yt-dark-explain-ask', path: lab('scene=explain-ask'), panel: true },
  { name: 'yt-dark-streaming', path: lab('scene=streaming&stream=hold'), panel: true },
  { name: 'yt-dark-explain', path: lab('scene=explain'), panel: true },
  { name: 'yt-light-explain', path: lab('scene=explain&theme=light'), panel: true },
  { name: 'yt-dark-summary', path: lab('scene=summary'), panel: true },
  { name: 'yt-dark-summary-choice', path: lab('scene=summary-choice'), panel: true },
  { name: 'yt-dark-capture', path: lab('scene=capture'), panel: true },
  { name: 'yt-light-capture', path: lab('scene=capture&theme=light'), panel: true },
  { name: 'yt-dark-loading', path: lab('scene=loading'), panel: true },
  { name: 'yt-dark-error', path: lab('scene=error'), panel: true },
  { name: 'yt-dark-toast', path: lab('scene=toast') },
  { name: 'yt-dark-toast-error', path: lab('scene=toast-error') },
  { name: 'yt-dark-prompt', path: lab('scene=prompt') },
  { name: 'yt-dark-floating', path: lab('scene=floating'), viewport: { width: 1000, height: 800 }, panel: true },
  { name: 'nf-idle', path: lab('scene=idle&host=netflix'), act: hoverRow(12), panel: true },
  { name: 'nf-explain', path: lab('scene=explain&host=netflix'), panel: true },
  { name: 'nf-capture', path: lab('scene=capture&host=netflix'), panel: true },
  ...['Anki', 'Card mapping', 'Quick cards', 'Whisper', 'AI', 'Hotkeys', 'Capture'].flatMap((section) =>
    (['light', 'dark'] as const).map((scheme) => ({
      name: `options-${scheme}-${section.toLowerCase().replace(/\s+/g, '-')}`,
      path: options(`section=${encodeURIComponent(section)}`),
      colorScheme: scheme,
      viewport: { width: 1200, height: 900 },
    })),
  ),
  {
    name: 'options-light-anki-down',
    path: options('section=Anki&anki=down'),
    colorScheme: 'light',
    viewport: { width: 1200, height: 900 },
  },
];

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });
await server.listen();
const base = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
const outDir = join(here, 'shots', style ?? 'base');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const shot of SHOTS) {
    if (only && !shot.name.includes(only)) continue;
    const context = await browser.newContext({
      viewport: shot.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: shot.colorScheme ?? 'dark',
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`  [${shot.name}] ${e.message}`));
    await page.goto(base + shot.path);
    await page.waitForSelector('html[data-ready]', { state: 'attached', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await shot.act?.(page);
    await page.waitForTimeout(250); // panel open animations
    await page.screenshot({ path: join(outDir, `${shot.name}.png`), scale: 'css' });
    if (shot.panel) {
      await page.locator('#m2-sidebar').screenshot({ path: join(outDir, `${shot.name}.panel.png`) });
    }
    console.log(`✓ ${shot.name}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`\nShots in ${outDir}`);

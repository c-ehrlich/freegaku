// Loads the built extension (pnpm build) into Playwright's Chromium, opens a
// real page, screenshots it, and saves the transcript the sidebar shows as a
// fixture — the one-off "real data" check that the lab matches reality.
//   pnpm lab:real "https://www.youtube.com/watch?v=…"
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2];
if (!url) throw new Error('Usage: pnpm lab:real <video url>');
const extension = join(here, '..', 'dist', 'chrome-mv3');
const outDir = join(here, 'shots', 'real');
await mkdir(outDir, { recursive: true });

const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'freegaku-lab-')), {
  channel: 'chromium',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  locale: 'en-US',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const page = await context.newPage();
  await page.goto(url);
  // EU consent interstitial, if any.
  const reject = page.getByRole('button', { name: /reject all/i }).first();
  if (await reject.isVisible({ timeout: 3000 }).catch(() => false)) await reject.click();
  await page.waitForSelector('#m2-sidebar .m2-row', { timeout: 45_000 });
  const video = page.locator('video').first();
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    v.currentTime = Math.min(120, v.duration / 3 || 60);
    void v.play();
  });
  await page.waitForTimeout(3000);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, 'page.png'), scale: 'css' });
  await page.locator('#m2-sidebar').screenshot({ path: join(outDir, 'panel.png') });
  const rows = await page.$$eval('#m2-sidebar .m2-row', (els) =>
    els.map((el) => ({
      time: el.querySelector('.m2-time')?.textContent ?? '',
      text: el.querySelector('.m2-text')?.textContent ?? '',
    })),
  );
  await writeFile(join(outDir, 'transcript.json'), JSON.stringify({ url, rows }, null, 2));
  console.log(`${rows.length} rows → ${outDir}`);
} finally {
  await context.close();
}

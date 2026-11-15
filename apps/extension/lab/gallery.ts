// Writes lab/shots/index.html: every scene in a row, one column per shot set
// (base, then each direction), for comparing directions side by side.
//   pnpm lab:gallery
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shots = join(dirname(fileURLToPath(import.meta.url)), 'shots');
const sets = (await readdir(shots, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && d.name !== 'real')
  .map((d) => d.name)
  .sort((a, b) => (a === 'base' ? -1 : b === 'base' ? 1 : a.localeCompare(b)));

const files = new Map<string, Set<string>>();
for (const set of sets) {
  for (const file of await readdir(join(shots, set))) {
    if (!file.endsWith('.png')) continue;
    if (!files.has(file)) files.set(file, new Set());
    files.get(file)!.add(set);
  }
}
// Panels first (the detail that differs), then full pages.
const names = [...files.keys()].sort((a, b) => {
  const pa = a.includes('.panel.') ? 0 : 1;
  const pb = b.includes('.panel.') ? 0 : 1;
  return pa - pb || a.localeCompare(b);
});

const rows = names
  .map((file) => {
    const cells = sets
      .map((set) =>
        files.get(file)!.has(set)
          ? `<a href="${set}/${file}"><img loading="lazy" src="${set}/${file}"></a>`
          : '<div class="none">—</div>',
      )
      .join('');
    return `<section><h2>${file.replace('.png', '')}</h2><div class="row">${cells}</div></section>`;
  })
  .join('\n');

await writeFile(
  join(shots, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Freegaku lab</title>
<style>
  body { margin: 0; padding: 24px; font: 13px system-ui; background: #111; color: #ddd; }
  header, .row { display: grid; grid-template-columns: repeat(${sets.length}, minmax(0, 1fr)); gap: 16px; }
  header { position: sticky; top: 0; padding: 8px 0; background: #111; font-weight: 600; text-transform: capitalize; z-index: 1; }
  h2 { font-size: 12px; font-weight: 500; color: #888; margin: 28px 0 8px; }
  img { width: 100%; border-radius: 6px; display: block; }
  .none { color: #555; }
</style>
<header>${sets.map((s) => `<div>${s}</div>`).join('')}</header>
${rows}
`,
);
console.log(`${join(shots, 'index.html')} — ${names.length} scenes × ${sets.length} sets`);

// The real options page with mocked storage and AnkiConnect.
//   ?section=<nav label>  opens that section (e.g. section=Card%20mapping)
//   &anki=down            AnkiConnect unreachable
//   &style=<direction>    (lab/directions/<direction>.css, layered on top)
import './mock-browser';
import { createRoot } from 'react-dom/client';
import { App } from '../src/entrypoints/options/App';
import { applyTheme } from '../src/entrypoints/options/theme';
import '../src/entrypoints/options/style.css';

const params = new URLSearchParams(location.search);
const section = params.get('section');
const style = params.get('style');

const directions = import.meta.glob('./directions/*.css', { query: '?raw', import: 'default' });

async function main(): Promise<void> {
  applyTheme();
  if (style) {
    const load = directions[`./directions/${style}.css`];
    if (!load) throw new Error(`No direction "${style}"`);
    const el = document.createElement('style');
    el.id = 'm2-direction';
    el.textContent = (await load()) as string;
    document.getElementById('m2-ui')!.after(el);
  }

  createRoot(document.getElementById('root')!).render(<App />);

  // Navigate like a user would, then wait for AnkiConnect data to land.
  for (let i = 0; i < 100 && !document.querySelector('nav button'); i++) await tick();
  if (section) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
      (b) => b.textContent === section,
    );
    button?.click();
  }
  for (let i = 0; i < 10; i++) await tick();
  document.documentElement.dataset.ready = '1';
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 30));
}

void main();

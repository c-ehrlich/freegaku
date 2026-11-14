// Mounts the real in-page UI (Sidebar, Overlay, toast, prompt) next to a
// fake host page and puts it in the state named by the URL:
//   ?scene=idle|chip|explain|explain-ask|streaming|summary|summary-choice|capture|loading|error|toast|prompt|floating
//   &theme=dark|light   (YouTube only; Netflix is always dark)
//   &host=youtube|netflix
//   &style=<direction>  (lab/directions/<direction>.css, layered on top)
// Sets <html data-ready> once the scene is settled, for lab/shoot.ts.
import './mock-browser';
import type { SubtitleCue } from '@migaku2/subtitles';
import { Overlay } from '../src/lib/overlay';
import { promptFront } from '../src/lib/prompt';
import { Sidebar } from '../src/lib/sidebar';
import { NF_CSS } from '../src/lib/sidebar-netflix';
import { showToast } from '../src/lib/toast';
import { ensureUiStyles } from '../src/lib/ui/tokens';
import { ACTIVE_INDEX, CUES, NOW_MS, SUMMARY_FOLLOW_UP, TRACKS, VIDEO, VIDEO_INFO } from './fixtures';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'idle';
const host = params.get('host') ?? 'youtube';
const theme = params.get('theme') ?? 'dark';
const style = params.get('style');

const directions = import.meta.glob('./directions/*.css', { query: '?raw', import: 'default' });

async function main(): Promise<void> {
  ensureUiStyles();
  if (style) {
    const load = directions[`./directions/${style}.css`];
    if (!load) throw new Error(`No direction "${style}"`);
    const el = document.createElement('style');
    el.id = 'm2-direction';
    el.textContent = (await load()) as string;
    document.getElementById('m2-ui')!.after(el);
  }

  const sidebar = new Sidebar();
  const overlay = new Overlay();
  sidebar.videoInfo = () => VIDEO_INFO;
  sidebar.onMine = (request) => {
    if (request.adjust) openCapture(sidebar, request.from, request.to);
    else showToast('Added to “ノマド” — audio, screenshot, sentence');
  };

  if (host === 'netflix') {
    document.documentElement.toggleAttribute('dark', true);
    document.getElementById('nf')!.hidden = false;
    sidebar.host.classList.add('m2-nf', 'm2-dark');
    const nfStyle = document.createElement('style');
    nfStyle.textContent = NF_CSS;
    sidebar.host.append(nfStyle);
    document.getElementById('nf')!.append(sidebar.host);
    overlay.mount(document.getElementById('nf-player')!);
  } else {
    document.documentElement.toggleAttribute('dark', theme === 'dark');
    document.getElementById('yt')!.hidden = false;
    document.querySelector('.yt-title')!.textContent = VIDEO.title;
    document.querySelector('.yt-channel b')!.textContent = VIDEO.channel;
    if (scene === 'floating') {
      sidebar.host.classList.add('m2-floating');
      document.body.append(sidebar.host);
    } else {
      document.getElementById('secondary')!.prepend(sidebar.host);
    }
    overlay.mount(document.getElementById('movie_player')!);
  }

  const cues = scene === 'summary-choice' ? longTranscript() : CUES;
  sidebar.setTracks(TRACKS, 0);
  sidebar.setGenerateAvailable(true);

  if (scene === 'loading') {
    sidebar.setCues([]);
    sidebar.setStatus('Loading subtitles…');
    return ready();
  }
  if (scene === 'error') {
    sidebar.setCues([]);
    sidebar.setStatus('Subtitle download came back empty.', true);
    return ready();
  }

  sidebar.setCues(cues);
  sidebar.updateTime(NOW_MS, true);
  overlay.setText(CUES[ACTIVE_INDEX]!.text);
  await settle();
  sidebar.recenter();

  switch (scene) {
    case 'chip':
      selectText(ACTIVE_INDEX, 5, 9);
      await wait(250); // the chip is debounced on selectionchange
      break;
    case 'explain':
    case 'explain-ask':
    case 'streaming': {
      const text = CUES[ACTIVE_INDEX]!.text;
      sidebar.showExplainPanel({
        from: ACTIVE_INDEX,
        to: ACTIVE_INDEX,
        mode: 'update',
        selText: text.slice(5, 13),
        adjust: true,
      });
      if (scene !== 'explain-ask') clickPrimary();
      break;
    }
    case 'summary':
      click('.m2-summarize');
      await settle();
      typeQuestion(SUMMARY_FOLLOW_UP);
      clickPrimary();
      break;
    case 'summary-choice':
      click('.m2-summarize');
      break;
    case 'capture':
      openCapture(sidebar, ACTIVE_INDEX - 1, ACTIVE_INDEX);
      break;
    case 'toast':
      showToast('Added to “直接” — audio, screenshot, sentence');
      break;
    case 'toast-error':
      showToast('AnkiConnect is not reachable. Is Anki running?', 'error');
      break;
    case 'prompt':
      void promptFront('日焼け止め');
      break;
  }
  await settle();
  ready();
}

function openCapture(sidebar: Sidebar, from: number, to: number): void {
  const start = CUES[from]!.start;
  const end = CUES[to]!.end;
  sidebar.showCaptureEditor({
    startMs: start - 500,
    endMs: end + 500,
    imageMs: (start + end) / 2,
    windowStartMs: start - 3000,
    windowEndMs: end + 3000,
    cueRanges: CUES.slice(from, to + 1).map((c) => ({ startMs: c.start, endMs: c.end })),
    selectedLineCount: to - from + 1,
    onFrameChange: () => {},
    onPreviewAudio: async () => {},
    onConfirm: async () => true,
    onCancel: () => {},
  });
}

function longTranscript(): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  for (let i = 0; out.length < 12_000; i++) {
    for (const cue of CUES) out.push({ ...cue, start: cue.start + i * 100_000, end: cue.end + i * 100_000 });
  }
  return out;
}

function selectText(row: number, start: number, end: number): void {
  const text = document.querySelectorAll<HTMLElement>('#m2-sidebar .m2-text')[row]!;
  const node = text.firstChild!;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

function click(selector: string): void {
  document.querySelector<HTMLElement>(`#m2-sidebar ${selector}`)!.click();
}

function clickPrimary(): void {
  click('.m2-assistant-actions .m2-primary');
}

function typeQuestion(text: string): void {
  const input = document.querySelector<HTMLTextAreaElement>('#m2-sidebar .m2-assistant-input')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function ready(): void {
  document.documentElement.dataset.ready = '1';
}

void main();

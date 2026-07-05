import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Default .output/ is invisible in Finder dialogs (dotfile) — use dist/.
  outDir: 'dist',
  manifest: {
    name: 'Freegaku',
    description: 'YouTube/Netflix subtitle sidebar + Anki mining (personal build)',
    // tabCapture + offscreen + activeTab: DRM-safe audio capture on Netflix.
    // unlimitedStorage: generated subtitle tracks are cached per video.
    permissions: ['storage', 'unlimitedStorage', 'tabCapture', 'offscreen', 'activeTab'],
    host_permissions: [
      // AnkiConnect — calls must come from the extension origin.
      'http://127.0.0.1:8765/*',
      '*://www.netflix.com/*',
    ],
    commands: {
      // A commands shortcut counts as "invoking" the extension, granting
      // activeTab — which tabCapture and captureVisibleTab require. One press
      // unlocks capture for the tab AND mines the current line.
      'mine-current-line': {
        suggested_key: { default: 'Alt+M' },
        description: 'Mine the current subtitle line to Anki',
      },
    },
  },
});

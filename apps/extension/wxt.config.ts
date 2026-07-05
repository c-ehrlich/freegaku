import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Default .output/ is invisible in Finder dialogs (dotfile) — use dist/.
  outDir: 'dist',
  manifest: {
    name: 'migaku2',
    description: 'YouTube subtitle sidebar + Anki mining (personal build)',
    permissions: ['storage'],
    // AnkiConnect (milestone 3) — calls must come from the extension origin.
    host_permissions: ['http://127.0.0.1:8765/*'],
  },
});

# migaku2 — YouTube subtitle mining extension

A small Chrome (MV3) extension for mining Anki cards from YouTube videos, tuned to one
person's workflow. Inspired by Migaku's Subtitle Browser, built on techniques proven by
asbplayer and Animebook.

## Core user flow

1. Open a YouTube video. The extension discovers subtitle tracks (manual and
   auto-generated/ASR) and shows a **sidebar** to the right of the video: one row per
   subtitle line, auto-scrolling with playback, active line highlighted, click to seek.
   An **overlay** renders the current line over the video (Yomitan-scannable).
2. Mine a word from the sidebar or overlay text with **Yomitan** as usual (fills Word,
   Reading, Pitch, Glossary, Sentence on a `MINING: 単語` / `MINING: 文法` note).
3. Click **+** on the line (or shift-click to select a range, then the shared +). The
   extension captures sentence audio and a screenshot, finds the newest MINING note via
   AnkiConnect, and fills:
   - `Sentence-Audio` — `[sound:...]` MP3 clip of the selected span (± padding)
   - `Image` — video frame from the middle of the span (JPEG)
   - `Sentence` — text of the selected line(s), re-applying Yomitan's bold markup
     around the mined word (asbplayer's `inheritHtmlMarkup` trick)
   - `Origin` — video title, channel, timestamped URL
4. Toast confirms; Anki's card browser is pointed at the note.

### Secondary flow: quick Basic cards (non-Japanese lines)

Occasionally mine an English (or other) sentence: a secondary action on a line
(modifier-click on +) creates a **new note** with the `Basic` note type via `addNote`,
in the same deck as the Japanese cards. Front = word/selection (small inline prompt,
prefilled from text selection); Back = sentence + audio + image + origin. Kept on
`Basic` so it never pollutes MINING stats. (Details to refine when implemented.)

## Settled decisions

| Topic | Decision |
|---|---|
| Anki integration | **Update-last only** via AnkiConnect (localhost:8765), from the service worker. Newest-note query filtered to the MINING note types (`added:2 is:new`, max note id) so it can never hit an unrelated card. Plus the standalone Basic-card flow above. |
| Yomitan | No direct integration. Yomitan scans our DOM text; its own AnkiConnect config creates the card. We only enrich it. |
| Languages | Japanese-tuned defaults; Basic-card flow for anything else. |
| ASR captions | Keep YouTube's own line segmentation (`fmt=srv3`), clamp rolling-caption overlaps (asbplayer's trick). No sentence-merge heuristics. |
| UI | Sidebar (docked in `#secondary`) **and** on-video overlay. Independently toggleable: **Alt+S** overlay, **Alt+G** sidebar. Toggle state remembered globally (`chrome.storage.local`). |
| Audio | Replay the span in real time, record via `video.captureStream()` + MediaRecorder (opus/webm), encode to **MP3** (mobile Anki compatibility). Audible replay, resume playback position after. Default padding ±0.5 s, configurable. |
| Screenshot | Canvas `drawImage` on the `<video>` (no DRM on YouTube), JPEG q≈0.9, at span midpoint, after `seeked` + `requestVideoFrameCallback`. |
| Media files | `storeMediaFile` with `deleteExisting: false` + random suffix; write `[sound:...]` / `<img>` refs into fields via `updateNoteFields`. Blank-then-show `guiBrowse` dance to avoid the open-browser update bug (AnkiConnect #82). |
| Repo | Turborepo + pnpm workspaces. Chrome-only. TypeScript + WXT for the extension, vanilla DOM UI in Shadow DOM (no framework). |

## Caption acquisition (the fragile part)

YouTube caption URLs increasingly require a PO token (`pot=`); URLs built from
`ytInitialPlayerResponse` alone often return empty 200s. Three-tier fallback, same as
asbplayer:

1. **Live player state** (primary): in a MAIN-world content script, poll
   `document.querySelector('#movie_player').getAudioTrack().captionTracks` until track
   URLs carry `pot=`. The player's own URLs are always valid.
2. **ANDROID InnerTube client**: POST `/youtubei/v1/player` with
   `clientName: 'ANDROID'`; its caption URLs currently need no POT.
3. *(later, if needed)* sessionStorage POT decode, and/or a **Cloudflare Worker** that
   downloads audio and runs ASR server-side (Migaku's approach) — the monorepo exists
   so this can slot in as `apps/worker` without restructuring.

Tracks are fetched as `fmt=srv3` (word-level `<s>` timing available in ASR tracks) from
the isolated content script (same-origin on youtube.com). Auto-translated tracks via
`tlang=` are possible later.

## Monorepo layout

```
apps/
  extension/     WXT Chrome extension (MV3)
packages/
  subtitles/     Pure-TS caption parsing (srv3/json3 → cues). No DOM/Node APIs, so a
                 future Cloudflare Worker can reuse it.
apps/worker/     (future) CF Worker: yt-dlp-style audio grab + server-side ASR fallback.
```

## Extension architecture

- `youtube-main.content.ts` — MAIN world, `document_start`, youtube.com/watch|shorts|embed.
  Discovers caption tracks (tiers 1–2), watches SPA navigation (`yt-navigate-finish` +
  video-id polling belt-and-braces), posts `{videoId, tracks[]}` to the isolated world
  via CustomEvent.
- `youtube.content.ts` — isolated world. Fetches + parses the chosen track, renders
  sidebar + overlay (Shadow DOM), syncs to `video.timeupdate`, handles seeks, selection,
  hotkeys, capture orchestration. Relays Anki calls to the service worker.
- `background.ts` — AnkiConnect client (extension-origin fetch), MP3 encoding worker
  host if needed, settings.
- `options/` — padding, deck/model filter, hotkeys, image quality (later milestone).

## Milestones

1. **Read** ✅: track discovery → sidebar with centered auto-scroll (pauses while
   video paused/hovering, recenters on resume)/active-line/click-to-seek, track
   picker, Alt+G. Automatic InnerTube fallback when player URLs return empty
   (POT enforcement) — validated live.
2. **Overlay** ✅: current-line overlay in #movie_player, Alt+S, states persisted.
3. **Mine** ✅: per-row ＋ button + multi-line selection chip; captureStream+
   MediaRecorder replay capture, lamejs MP3, canvas screenshot at span midpoint;
   AnkiConnect update-last (note-type-filtered) with field-existence checks,
   markup inheritance, guiBrowse dance, toasts. E2E-verified against real Anki.
4. **Basic cards** ✅: Alt+click ＋/chip → Front prompt (selection-prefilled, Esc
   cancels pre-capture) → `addNote` Basic in the 日本語 deck, Back = sentence +
   audio + image + origin, tagged `m2`. E2E-verified.
5. **Polish** ✅: options page (padding, deck/note types, hotkeys), error surfaces.
   (Worker fallback still open.)
6. **Netflix** ✅: manifest interception (WebVTT profile + showAllSubDubTracks,
   rename-tolerant), player-API seek bridge + preciseSeeking hack, LR-style
   right sidebar (player shrunk via CSS), overlay, mining via tabCapture +
   offscreen doc (audio) and captureVisibleTab + DPR crop (screenshot, Netflix
   chrome hidden during shot). Alt+M command = mine current line AND grants
   the activeTab permission tab capture requires (one press per browser
   session unlocks the ＋ buttons too). Verified live against real Netflix
   (ja CC track, episodic metadata in Origin). See docs/netflix.md.

## Known risks

- All YouTube surfaces used are unofficial (`#movie_player` API, InnerTube, `yt-navigate-finish`,
  srv3). Expect breakage; keep acquisition code isolated behind one interface.
- `updateNoteFields` silently fails if the note is open in Anki's browser → guiBrowse dance.
- "Newest note" races (sync, AnkiDroid): mitigated by note-type filter + `is:new`.
- tabCapture not needed (captureStream suffices on YouTube; no DRM).

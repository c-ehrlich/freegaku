# Netflix support — research digest + implementation plan (2026-07-05)

Distilled from deep-dives into subadub, asbplayer (post-#1060), easysubs, Jelly-Party,
NflxMultiSubs, and a decompile of Language Reactor's shipped extension.

## Subtitles: manifest interception (the LR-hardened subadub method)

MAIN-world page script hooks, on netflix.com (no CSP obstacle — Netflix's CSP is
report-only, no Trusted Types):

- **`JSON.stringify` hook (request)**: when the object has `supportsPartialHydration`,
  set `showAllSubDubTracks = true` (forces Netflix to hydrate download URLs for ALL
  text tracks — this is LR's trick and the fix for asbplayer's flaky per-track
  hydration dance) and `profiles.unshift('webvtt-lssdh-ios8')` (adds WebVTT to the
  manifest response; default profiles only carry encrypted/image formats). Find the
  profiles array by structural search (subadub-style), not a hardcoded path.
- **`JSON.parse` hook (response)**: match `value.result` with `textTracks` OR legacy
  `timedtexttracks` (Netflix renamed fields June 2026: `timedtexttracks→textTracks`,
  `ttDownloadables→downloadables`, `new_track_id→id`, `downloadUrls→urls`). Accept
  both names via `??` chains (LR's approach — the robust one). Per track: skip
  `isForcedNarrative`/`isNoneTrack`/image-based; take
  `downloadables['webvtt-lssdh-ios8'].urls[0].url`, language, `languageDescription`,
  CC flag from `rawTrackType === 'closedcaptions'`. Cache per movieId.
- Track download: plain `fetch` of the CDN URL (tokenized, no auth). Format: proper
  WebVTT, timeline-aligned (no offset). Quirks: `&lrm;/&rlm;` entities, simple
  `<i>/<b>/<u>/<c.x>` tags, `line:` cue settings. Parse in `packages/subtitles`
  (new `parseWebVtt`).
- Manifest interception only sees manifests fetched AFTER the hook installs — the
  page script must run at `document_start`. For a video already playing before
  install (edge case), a reload notice suffices; LR does similar.

## Player control (unofficial API, verified across 3 codebases)

MAIN world: `netflix.appContext.state.playerApp.getAPI().videoPlayer`;
session id = `getAllPlayerSessionIds().filter(id => id.startsWith('watch')).at(-1)`;
`player = getVideoPlayerBySessionId(id)`. All times in **ms**.

- **Seek: `player.seek(ms)` ONLY.** Setting `video.currentTime` breaks the cadmium
  player (all sources agree). Reading `video.currentTime` is safe.
- `play()/pause()/getCurrentTime()/getDuration()/getMovieId()`.
- Optional: `Function.prototype.apply` proxy forcing the `preciseSeeking` config flag
  (asbplayer + LR both ship it) for frame-precise seeks. Phase 2.
- Current title: `document.querySelector('*[data-videoid]')?.dataset.videoid`
  (subadub + easysubs both poll this at 500ms; URL `/watch/<id>` can lag/be a trailer).
  Cross-check with `player.getMovieId()`.
- Metadata: `getAPI().getVideoMetadataByVideoId(id).getCurrentVideo()` →
  `getTitle()/isEpisodic()/getSeason()._season.seq/getEpisodeNumber()/getEpisodeTitle()`.

## Sidebar layout (Jelly-Party/LR recipe)

No sidebar slot exists; the page is a full-viewport player. The proven approach:

- Append panel (width ~400px, absolute right, height 100%) **inside `.watch-video`**
  (so it survives native fullscreen — Netflix fullscreens the player container, and
  body-appended UI vanishes; this was LR's historical fullscreen bug).
- Shrink the player with CSS: `.watch-video--player-view { width: calc(100vw - 400px) }`
  when sidebar visible. Netflix's player observes its container and relayouts.
- Stable selectors: `.watch-video`, `.watch-video--player-view`, `data-uia=*`
  attributes. NEVER the emotion `ltr-xxxxx` classes.
- Netflix unmounts (not hides) its control bar when idle; don't inject into it.
  stopPropagation on mousemove inside our panel so Netflix can idle out.
- Keyboard: the sidebar uses browser-level Alt+T; Netflix ignores the page-level Alt+S overlay key.
  Panel inputs need stopPropagation so unmodified keys don't hit Netflix shortcuts.

## Capture under DRM

- **Audio — `chrome.tabCapture`** (records the tab's decoded output; DRM-irrelevant):
  SW: `tabCapture.getMediaStreamId({targetTabId})` → offscreen document (reason
  USER_MEDIA): `getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',
  chromeMediaSourceId}}})` → MediaRecorder. MUST loop the stream back to the
  speakers (`AudioContext.createMediaStreamSource(stream).connect(ctx.destination)`)
  or the tab goes silent during recording. Requires `tabCapture` + `offscreen` +
  `activeTab` permissions and a user gesture (our ＋ click qualifies). Stream IDs are
  single-use and expire in seconds — create the offscreen doc BEFORE requesting the id.
  `video.captureStream()` does NOT work on EME media (silent tracks).
- **Screenshot — `chrome.tabs.captureVisibleTab`** (canvas is black on EME):
  desktop Chrome/Brave use Widevine L3 software decode, so the composited tab bitmap
  contains real frames. Crop to `video.getBoundingClientRect()` **× devicePixelRatio**
  (Retina!). Tab must be visible. Hide our own overlay/panel chrome during the shot.
  If frames come out black: disable hardware acceleration in the browser (forces the
  software compositing path).

## Testing

Chrome for Testing has no Widevine and Netflix refuses unsigned builds → no headless
E2E. Live validation drives the user's Brave (keeps `--load-extension` support, has
Widevine + Netflix login): one-time Load-unpacked into Brave, then relaunch Brave
with `--remote-debugging-port=9222` and attach `puppeteer.connect` (never `launch`).
Mining gestures must go through real page events (trusted clicks/keys), not SW pokes,
to satisfy the activeTab/gesture requirement of tabCapture.

## Implementation shape (milestone 6)

Refactor the content side into site adapters sharing the Sidebar/Overlay/Anki/toast
machinery:

- `SiteAdapter`: `seek(ms)`, `captureAudio(span)`, `captureImage(t)`,
  `sidebarMount()`, `overlayMount()`, video element discovery, origin metadata.
- YouTube adapter = current behavior (captureStream + canvas).
- Netflix adapter: `netflix-main.content.ts` (MAIN, document_start: JSON hooks,
  player API bridge via postMessage — track list, seek, play/pause, metadata) +
  content UI reusing Sidebar/Overlay; audio via new offscreen-recorder service,
  image via captureVisibleTab+crop in the SW.
- `packages/subtitles`: add WebVTT parser (Netflix flavor: entities, tags, no offset).
- Manifest: add netflix host matches; permissions `tabCapture`, `offscreen`,
  `activeTab`.

Fragility watch-list: manifest field renames (recurred 2022, 2026), `.watch-video*`
selectors, the player API surface, `showAllSubDubTracks` honored server-side.

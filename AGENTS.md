# AGENTS.md

Guidance for AI agents and human contributors working in this repository.

## What this project is

A small browser tool that replaces a video streaming site's fixed,
bottom-anchored captions with a **draggable, resizable, recolorable caption
overlay**, plus optional auto-scrolling for long captions. Captions come from a
**source adapter**: native HTML5 WebVTT tracks (Patreon, Vimeo, Streamable,
hls.js/Shaka/Video.js/Plyr/JW Player), or **YouTube's own caption DOM** (hidden
and mirrored into our overlay). A **settings dashboard** sets persistent default
looks (global or per-site); live edits are a per-site **session override** that
layers on top. It ships in three forms, all built from a single source file.

Settings resolution: built-in  <  global default  <  per-site default  <  session override.

## Golden rule: one source of truth

**All behavior lives in `src/caption-customizer.js`.** Never edit the generated
artifacts by hand — they are overwritten by the build:

- `userscript/cyber-captions-customizer.user.js` — generated (header + src)
- `chrome-extension/content.js` — generated (copy of src)
- `firefox-extension/content.js` — generated (copy of src)

Edit `src/caption-customizer.js`, then run `npm run build`.

## Repository layout

```
src/caption-customizer.js        Single source of truth (the IIFE)
userscript/                      Subproject 1 — Tampermonkey / Greasemonkey
  userscript-header.txt          The // ==UserScript== metadata block (edit @version here)
  cyber-captions-customizer.user.js   (generated)
chrome-extension/                Subproject 2 — Chrome / Opera / Edge (MV3)
  manifest.json                  version synced from the userscript header by build.js
  content.js                     (generated)   icons/ (generated placeholders)
  options.html                   loads content.js in "panel mode" to host the dashboard (static)
  background.js                  opens options on toolbar click; re-registers custom sites (static)
firefox-extension/               Subproject 3 — Firefox (MV3)
  manifest.json                  browser_specific_settings.gecko.id; version synced by build
  content.js                     (generated)   icons/ (generated placeholders)
  options.html / background.js   same roles as Chrome (static)
test/                            DEV-ONLY test suite — never shipped in any artifact
  simulate.js                    Fake-DOM simulation + stress/leak/perf assertions
build.js                         Generates content.js + userscript + icons + version sync
```

`options.html` and `background.js` are **static, hand-maintained** per extension
(not generated). The dashboard UI itself lives in the shared source, so the
options page is a thin host that sets `window.__CCC_PANEL_MODE__` and loads
`content.js`.

## Workflow for any change

1. Edit `src/caption-customizer.js` (and `userscript/userscript-header.txt` for
   version/description/`@match` changes — bump `@version`).
2. `npm run verify` — runs `node --check`, the build, and the full test suite.
3. Confirm all tests pass before committing.

Commands:

- `npm run build` — regenerate userscript + both extensions + icons.
- `npm test` — run the simulation suite (`node test/simulate.js`).
- `npm run check` — syntax-check the source.
- `npm run verify` — do all of the above.

## Constraints / conventions

- **No dependencies, no build tooling beyond Node's stdlib.** `build.js` and the
  test harness use only `fs`, `path`, `zlib`. Keep it that way — it keeps the
  shipped artifacts tiny and the review surface small.
- **The test suite must not be bundled** into any extension/userscript artifact.
  It exists only under `test/` and loads `src/caption-customizer.js` directly.
- **Keep the source framework-free.** It uses only DOM/Web APIs available to a
  content script in the isolated world (`document`, `video.textTracks`,
  `MutationObserver`, `requestAnimationFrame`, `localStorage`, `getComputedStyle`).
- **Performance is a feature.** The document MutationObserver inspects only added
  nodes (never re-scans the whole document); the scroll engine cancels its timer
  and rAF on every new cue; the **YouTube observer dedupes on caption text** so
  our own overlay writes never re-trigger it (a real infinite-loop risk — the
  test suite asserts against it); the native-caption sniff is bounded and stops
  once a renderer is found. Don't regress these.
- **Storage** goes through an abstraction that prefers `chrome.storage.sync`
  (extensions), then `GM_getValue`/`GM_setValue` (userscript), then
  `localStorage`. `store.load(cb)` is synchronous for the latter two and async
  for chrome.storage. Settings live under one key: `ccc-settings-v3` (tiers:
  `coverage`, `customSites`, `defaults.global`, `defaults.platforms`,
  `overrides`). The pre-v3 `patreon-caption-style-v2` key is migrated on boot
  into `overrides['patreon.com']`.
- The source exposes a namespaced `window.CaptionCustomizer` API (settings,
  `resolveStyle`, `openPanel`, `mountPanel`, `refresh`) used by the options page
  and the test harness. It carries no secrets and only affects the user's own
  caption preferences.

## How it works (mechanism)

A caption **source adapter** feeds text lines into one shared overlay:

- **Native tracks** — `findContainer` picks the player container for a `<video>`
  (nearest `VideoPlayerRoot`/player-ish ancestor, else the video's parent), the
  active caption track is set to `mode = "hidden"` (browser stops drawing it but
  still fires `cuechange`), and each cue's text is rendered.
- **YouTube** — `youtubeContainer` anchors to the player, YouTube's caption DOM
  is hidden via CSS, and a MutationObserver mirrors the live segment text (with
  text-dedup to avoid self-triggering).

**Suppressing the player's own captions.** `mode = "hidden"` only stops the
*browser* from painting cues. Players that render captions themselves (Vimeo,
video.js/Brightcove, JW, Plyr, Shaka, YouTube) already keep the track hidden and
read `activeCues`, so the mode flip is a no-op for them and their captions would
stack under ours — the user can only move/style ours. `hideNative()` therefore
puts `.pcr-hide-native` on the player container while the site is covered, which
hides known renderers by class (`KNOWN_NATIVE_SEL`, kept in sync with the CSS
block). For players not on that list it falls back to a **structural sniff**:
find the shallowest element inside the container whose normalized text equals the
current cue — skipping the video, our overlay, and their ancestors — and tag it
`.pcr-native-cap`. The sniff is bounded to `NATIVE_SNIFF_TRIES` per overlay and
is skipped entirely once a known renderer is found, so steady-state cue changes
do no extra DOM queries. Turning coverage off removes both the class and the tags.

The overlay renders `lines: string[]` and the user can drag it, resize the
container (corner handle), restyle it (font + text/background color + opacity in
the toolbar), and optionally auto-scroll. Live edits persist as the current
site's session override; the gear button opens the settings dashboard.

**Interaction model.** Two independent states drive the chrome: `.pcr-hover`
(set on `pointerenter`) reveals only the resize handle, while `.pcr-open` reveals
the toolbar and is set *only* by a click — a press whose travel stays under
`CLICK_SLOP` (4px), detected inside the drag gesture so repositioning never pops
the bar open. The toolbar closes three ways: the `×` button, an outside click, or
`HOVER_OUT_MS` (600ms) after the pointer leaves. The outside-click listener is
registered **once at module scope** over the shared `overlays` set — overlays are
created per `<video>` and never unregistered, so a per-overlay document listener
would accumulate across SPA video swaps.

**Stacking.** `sitBelowChrome()` puts the overlay one level *below* the player's
control bar so clicks on the timeline reach the player rather than the caption.
The level is measured, not hardcoded: a single value can't serve every player
(Vimeo's controls sit at z-index 37 over an `auto` video layer; YouTube's at 59
over 10). It finds the control bar via `KNOWN_CHROME_SEL`, walks up to the direct
child of the container on that path, reads its computed z-index and subtracts one
(falling back to DOM tree order below the bar when that level is `auto` or <= 0).
When no known control bar is found at all, it anchors to the `<video>` instead of
guessing a number: walk up from the video to the direct child of `container` on
that path (`vTop`; may be the video itself), tie the box's z-index to vTop's
computed level, and place the box immediately after vTop in tree order — so it
paints above the video while any other chrome (a later sibling, or a higher
z-index) still paints above the box. `CHROME_FALLBACK_Z` (20) is a last-resort
constant used only when no `<video>` can be located inside `container` at all
(e.g. it was removed). Chrome often mounts after the video, so all of this runs
on attach, again after 1500ms, and on every `refresh()` — idempotently, so the
recheck is a no-op once the box is already correctly placed. Consequence: where
the control bar overlaps the caption, the caption can't be clicked or dragged until
the chrome auto-hides.

## Site coverage

The tool runs on a **curated host list**, not all sites — edit the `@match`
lines in `userscript/userscript-header.txt` and the `content_scripts[0].matches`
arrays in both manifests to add/remove sites (keep the three in sync). Avoid
`*://*/*`: it triggers browsers' "all websites" permission warning and heavier
store review.

## Testing philosophy

`test/simulate.js` builds a minimal fake DOM with a **deterministic virtual
clock** and instrumented `setTimeout`/`requestAnimationFrame`/`MutationObserver`,
then drives the real source through realistic scenarios. It asserts:
no timer/rAF leaks under rapid cue changes, a bounded (terminating) track-mode
flip, one overlay per player (no stacking across SPA video swaps), no
full-document rescans on DOM churn, and correct drag/resize/color/scroll/persist
behavior. Add a scenario here for any new behavior.

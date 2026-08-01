# AGENTS.md

Guidance for AI agents and human contributors working in this repository.

## What this project is

A small browser tool that replaces a video streaming site's fixed,
bottom-anchored captions with a **draggable, resizable, recolorable caption
overlay** (similar to YouTube's movable captions), plus optional auto-scrolling
for long captions. It works on any player that exposes native HTML5 WebVTT
caption tracks — confirmed on Patreon; also targets Vimeo, Streamable, and
hls.js/Shaka/Video.js/Plyr/JW Player based sites (see the manifests'/header's
curated `matches`/`@match` list). It ships in three forms, all built from a
single source file.

## Golden rule: one source of truth

**All behavior lives in `src/caption-customizer.js`.** Never edit the generated
artifacts by hand — they are overwritten by the build:

- `userscript/patreon-caption-customizer.user.js` — generated (header + src)
- `chrome-extension/content.js` — generated (copy of src)
- `firefox-extension/content.js` — generated (copy of src)

Edit `src/caption-customizer.js`, then run `npm run build`.

## Repository layout

```
src/caption-customizer.js        Single source of truth (the IIFE)
userscript/                      Subproject 1 — Tampermonkey / Greasemonkey
  userscript-header.txt          The // ==UserScript== metadata block (edit @version here)
  patreon-caption-customizer.user.js   (generated)
chrome-extension/                Subproject 2 — Chrome / Opera / Edge (MV3)
  manifest.json                  version synced from the userscript header by build.js
  content.js                     (generated)   icons/ (generated placeholders)
firefox-extension/               Subproject 3 — Firefox (MV3)
  manifest.json                  browser_specific_settings.gecko.id; version synced by build
  content.js                     (generated)   icons/ (generated placeholders)
test/                            DEV-ONLY test suite — never shipped in any artifact
  simulate.js                    Fake-DOM simulation + stress/leak/perf assertions
build.js                         Generates the three artifacts + icons + version sync
```

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
- **Performance is a feature.** The MutationObserver inspects only added nodes
  (never re-scans the whole document); the scroll engine cancels its timer and
  rAF on every new cue. The test suite asserts these — don't regress them.
- Persisted user settings live in one `localStorage` key: `patreon-caption-style-v2`.

## How it works (mechanism)

Supported players render captions via native WebVTT text tracks. The script
finds the player container for a `<video>` (`findContainer`: nearest
`VideoPlayerRoot`/player-ish ancestor, else the video's parent — so Patreon
keeps its exact anchor while other sites still work), sets the active caption
track to `mode = "hidden"` (the browser stops drawing it but still fires
`cuechange`), then renders each cue into its own absolutely positioned overlay
that the user can drag, resize (the container, via the corner handle), restyle
(font size + text color + background color/opacity in the toolbar), and
optionally auto-scroll.

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

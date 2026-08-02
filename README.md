# Video Streaming Caption Customizer

Take control of captions and subtitles on **video streaming sites, including
YouTube**. Move them anywhere on the player, resize the caption box, set the
font size, recolor the text, and recolor the background box with its own
opacity, plus optional auto-scrolling for long captions. Set **persistent
default looks** (global or per-site) in a settings dashboard; live edits on a
video act as a per-site **session override** that persists across reloads until
you reset it.

Ships three ways, all built from **one source file**:

| Subproject | Folder | Target |
|---|---|---|
| Userscript | [`userscript/`](userscript/) | Tampermonkey / Greasemonkey |
| Chrome extension | [`chrome-extension/`](chrome-extension/) | Chrome, Opera, Edge (MV3) |
| Firefox extension | [`firefox-extension/`](firefox-extension/) | Firefox (MV3) |

## Supported sites

Two caption "families" are handled:

- **YouTube** — YouTube draws captions with its own DOM (not native tracks). The
  tool reads that live text, hides YouTube's rendering, and mirrors the captions
  into its own movable/resizable/recolorable overlay.
- **Native HTML5 WebVTT tracks** — a large class of the modern web. Confirmed on
  **Patreon**; also targets **Vimeo**, **Streamable**, and sites built on
  **hls.js**, **Shaka Player**, **dash.js**, **Video.js**, **Plyr**, or
  **JW Player**.

To check whether a non-YouTube site exposes native tracks, open DevTools on a
video page and run:

```js
[...(document.querySelector('video')?.textTracks ?? [])].map(t => ({kind:t.kind, cues:t.cues?.length}))
```

If it lists caption/subtitle tracks with cues, this tool works there.

The tool runs on a **curated list** of sites (toggle each in the dashboard)
rather than all websites, so the extension permission prompt stays specific. You
can also add your own sites — **as-is, unsupported** (see the dashboard's
disclaimer).

> Unofficial. Not affiliated with or endorsed by YouTube, Patreon, Vimeo, Streamable, or any other site.

## Settings dashboard

Open the dashboard from the **gear button** on the caption toolbar (any build),
from the extension's **options page**, or from the Tampermonkey menu. It lets you:

- **Choose covered sites** — enable/disable each curated site, or add your own.
- **Set default looks** — a **Global** default plus **per-site** defaults for
  position, size, font, colors, opacity, and auto-scroll.
- **Manage the session override** — live edits on a video are saved per site and
  layer on top of the defaults; clear them here or with **Reset**.

Effective look = built-in  <  global default  <  per-site default  <  session override.

## Features

- **Move** — drag the caption box anywhere (top, bottom, middle, sides).
- **Resize the container** — hover the box and drag the bottom-right corner to size the box freely (wider, taller, or both); words wrap by width and the height sets the reading window.
- **Font size** — a slider in the toolbar.
- **Recolor** — text color, and background box color **with its own opacity**; the text always stays fully opaque.
- **Auto-scroll (toggleable)** — long captions scroll up one line at a time inside the box height, paced for reading; turn it off to grow the box and show captions in full.
- **Adaptive, forgiving toolbar** — the controls flip above/below the box to stay on screen, appear on hover, and wait ~1s before closing so you can reach them.
- **Defaults + session override** — set persistent global/per-site defaults in the dashboard; live edits become a per-site override that persists across reloads until Reset.
- **Private & light** — no network requests, no tracking, no dependencies; all state stays in your browser (extension storage, userscript storage, or `localStorage`).

## Install

### Userscript (quickest)
1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Open [`userscript/cyber-captions-customizer.user.js`](userscript/cyber-captions-customizer.user.js) and let your manager install it.

### Chrome / Opera / Edge (unpacked)
1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the [`chrome-extension/`](chrome-extension/) folder.

### Firefox (temporary)
1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on** → select [`firefox-extension/manifest.json`](firefox-extension/manifest.json).

See each subproject's README for store-submission notes.

## Usage

Open a video on a supported site and turn captions on. Then:
- **Drag** the box to reposition it.
- **Hover** the box and **drag the corner handle** to resize the container.
- The hover **toolbar** sets font size, text/background color and opacity, and toggles **Auto-scroll long captions**.
- **Reset** restores defaults.

The box appears while a caption is on screen and stays put while you're actively adjusting it.

## Develop

One source of truth: [`src/caption-customizer.js`](src/caption-customizer.js).
Edit it, then rebuild the three artifacts.

```bash
npm run build     # regenerate userscript + both extensions + icons (version synced from the userscript header)
npm test          # run the dev-only simulation / stress / leak / performance suite
npm run verify    # syntax-check + build + test
```

The build and tests use only Node's standard library — **no dependencies**.
The [`test/`](test/) suite is development-only and is never bundled into any
shipped artifact. See [AGENTS.md](AGENTS.md) for contributor guidance.

## How it works

A **caption source adapter** feeds text into one shared overlay:

- On **native-track** players, the script sets the active caption track to
  `mode = "hidden"` (the browser stops drawing captions but still fires
  `cuechange`) and renders each cue.
- On **YouTube**, it hides YouTube's caption DOM and mirrors the live text via a
  MutationObserver.

Either way, each caption is drawn into an absolutely-positioned overlay the tool
fully controls. Position and size are stored as percentages of the player, so
they survive resizing and fullscreen, and a MutationObserver re-attaches the
overlay as single-page apps swap videos in and out.

## Privacy

No data collected, no network requests, no tracking — settings stay in your
browser (extension `storage`, userscript storage, or `localStorage`). See
[PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)

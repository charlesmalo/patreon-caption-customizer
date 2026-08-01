# Video Streaming Caption Customizer

Take control of captions and subtitles on **video streaming sites**. Move them
anywhere on the player, resize the caption box, set the font size, recolor the
text, and recolor the background box with its own opacity, plus optional
auto-scrolling for long captions — YouTube-style. Your settings persist across
videos and reloads.

Ships three ways, all built from **one source file**:

| Subproject | Folder | Target |
|---|---|---|
| Userscript | [`userscript/`](userscript/) | Tampermonkey / Greasemonkey |
| Chrome extension | [`chrome-extension/`](chrome-extension/) | Chrome, Opera, Edge (MV3) |
| Firefox extension | [`firefox-extension/`](firefox-extension/) | Firefox (MV3) |

## Supported sites

Works on any video player that exposes **native HTML5 WebVTT caption tracks** —
which is a large class of the modern web. Confirmed on **Patreon**; also targets
**Vimeo**, **Streamable**, and sites built on **hls.js**, **Shaka Player**,
**dash.js**, **Video.js**, **Plyr**, or **JW Player**.

Not every site works: some players (most notably **YouTube**) draw captions with
their own system rather than native tracks — YouTube already includes similar
drag/resize/color/position options, so it's out of scope. To check any site,
open DevTools on a video page and run:

```js
[...(document.querySelector('video')?.textTracks ?? [])].map(t => ({kind:t.kind, cues:t.cues?.length}))
```

If it lists caption/subtitle tracks with cues, this tool works there.

The browser extensions run on a **curated list** of these sites (see each
extension's `manifest.json` `matches`) rather than all websites, so the
permission prompt stays specific — add more sites there as needed.

> Unofficial. Not affiliated with or endorsed by Patreon, Vimeo, Streamable, or any other site.

## Features

- **Move** — drag the caption box anywhere (top, bottom, middle, sides).
- **Resize the container** — hover the box and drag the bottom-right corner to size the box freely (wider, taller, or both); words wrap by width and the height sets the reading window.
- **Font size** — a slider in the toolbar.
- **Recolor** — text color, and background box color **with its own opacity**; the text always stays fully opaque.
- **Auto-scroll (toggleable)** — long captions scroll up one line at a time inside the box height, paced for reading; turn it off to grow the box and show captions in full.
- **Adaptive, forgiving toolbar** — the controls flip above/below the box to stay on screen, appear on hover, and wait ~1s before closing so you can reach them.
- **Persistent** — position, size, font, colors, opacity, and the auto-scroll preference are saved and reused across videos and reloads.
- **Private & light** — no network requests, no tracking, no dependencies; all state in one `localStorage` key.

## Install

### Userscript (quickest)
1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Open [`userscript/patreon-caption-customizer.user.js`](userscript/patreon-caption-customizer.user.js) and let your manager install it.

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

These players deliver captions through the browser's native WebVTT text tracks.
The script sets the active caption track to `mode = "hidden"` (the browser stops
drawing the captions but still fires `cuechange`), then renders each cue into
its own absolutely-positioned overlay it fully controls. Position and size are
stored as percentages of the player, so they survive resizing and fullscreen,
and a MutationObserver re-attaches the overlay as single-page apps swap videos
in and out.

## Privacy

No data collected, no network requests, no tracking — all settings stay in your
browser's `localStorage`. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)

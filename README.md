# Patreon Caption Customizer

Take control of captions and subtitles on Patreon videos. Move them anywhere on
the player, resize the text, recolor the text **and** the background box
(with independent opacity), and optionally auto-scroll long captions within a
tidy two-line window — YouTube-style. Your settings persist across videos and
reloads.

Ships three ways, all built from **one source file**:

| Subproject | Folder | Target |
|---|---|---|
| Userscript | [`userscript/`](userscript/) | Tampermonkey / Greasemonkey |
| Chrome extension | [`chrome-extension/`](chrome-extension/) | Chrome, Opera, Edge (MV3) |
| Firefox extension | [`firefox-extension/`](firefox-extension/) | Firefox (MV3) |

## Features

- **Move** — drag the caption box anywhere (top, bottom, middle, sides).
- **Resize** — drag the bottom-right corner to scale the font (outward bigger, inward smaller).
- **Recolor** — hover the box for a toolbar with independent **color + opacity** for the text and for the background box.
- **Auto-scroll (toggleable)** — long captions scroll up one line at a time inside a 2-line window, paced for reading; turn it off to show captions in full.
- **Adaptive toolbar** — the controls flip above/below the box so they never overflow off the top of the frame.
- **Persistent** — position, size, colors, opacity, and the auto-scroll preference are saved and reused across videos and reloads.
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

Open a Patreon video and turn captions on. Then:
- **Drag** the box to reposition it.
- **Drag the corner handle** to change font size.
- **Hover the box** to open the toolbar: set text/background color and opacity, and toggle **Auto-scroll long captions**.
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

Patreon renders captions through the browser's native WebVTT text tracks. The
script sets the active caption track to `mode = "hidden"` (the browser stops
drawing the captions but still fires `cuechange` events), then renders each cue
into its own absolutely-positioned overlay it fully controls. Position is stored
as a percentage of the player, so it survives resizing and fullscreen, and a
MutationObserver re-attaches the overlay as Patreon's single-page app swaps
videos in and out.

## License

[MIT](LICENSE)

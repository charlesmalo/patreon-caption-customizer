# Chrome / Opera / Edge extension (MV3)

Manifest V3 build of Patreon Caption Customizer.

> `content.js` and `icons/` are generated. Edit
> [`../src/caption-customizer.js`](../src/caption-customizer.js) and run
> `npm run build` from the repo root. `manifest.json`'s `version` is synced from
> the userscript header by the build.

## Load unpacked (development)

1. Visit `chrome://extensions` (or `opera://extensions`, `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this `chrome-extension/` folder.
4. Open a Patreon video, turn captions on, and customize.

## Package for the Chrome Web Store

1. From the repo root, run `npm run build` to refresh `content.js` + `manifest.json`.
2. Replace the placeholder `icons/` with real 16/32/48/128 px PNG artwork.
3. Zip the **contents** of this folder (not the parent):
   ```bash
   cd chrome-extension && zip -r ../patreon-caption-customizer-chrome.zip . -x '*.DS_Store'
   ```
4. Upload the zip in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

The same package installs on Opera and Edge (both accept Chrome MV3 zips; Opera
also has its own add-ons site).

## Notes

- `run_at: document_start` matches the userscript so the overlay attaches before
  the player initializes.
- The content script runs in the isolated world and uses only DOM APIs
  (`video.textTracks`, `MutationObserver`, `localStorage`, …). If a future
  Patreon change hides caption tracks from the isolated world, switch the content
  script to `"world": "MAIN"` in the manifest.
- The dev-only test suite under `../test/` is intentionally **not** part of this
  package, to keep the extension small.

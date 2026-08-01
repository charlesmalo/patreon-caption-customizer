# Chrome / Opera / Edge extension (MV3)

Manifest V3 build of **Video Streaming Caption Customizer**.

> `content.js` and `icons/` are generated. Edit
> [`../src/caption-customizer.js`](../src/caption-customizer.js) and run
> `npm run build` from the repo root. `manifest.json`'s `version` is synced from
> the userscript header by the build.

## Which sites it runs on

The extension requests access to a **curated list of video/streaming sites**
(and their embedded player frames) — **not** all websites — so users only see a
short, specific permission prompt. The current list in `manifest.json`
(`content_scripts[0].matches`):

```
patreon.com, vimeo.com, streamable.com, dailymotion.com, ted.com,
twitch.tv, kick.com, wistia.com, wistia.net, brightcove.net,
floatplane.com, nebula.tv
```

It activates only when a page's player exposes native HTML5 WebVTT caption
tracks; on a listed site without captions it simply does nothing.

**To add a site:** append a match pattern like `"*://*.example.com/*"` to that
`matches` array (add it to `../firefox-extension/manifest.json` too for parity).
Avoid `*://*/*` — that triggers Chrome's "read and change data on all websites"
warning and heavier store review.

## Load unpacked (development)

1. Visit `chrome://extensions` (or `opera://extensions`, `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this `chrome-extension/` folder.
4. Open a video on a supported site, turn captions on, and customize.

## Package for the Chrome Web Store

1. From the repo root, run `npm run build` to refresh `content.js` + `manifest.json`.
2. Replace the placeholder `icons/` with real 16/32/48/128 px PNG artwork.
3. Zip the **contents** of this folder (not the parent):
   ```bash
   cd chrome-extension && zip -r ../patreon-caption-customizer-chrome.zip . -x '*.DS_Store'
   ```
4. Upload the zip in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
5. For the **privacy** section: the extension collects no data — link
   [`../PRIVACY.md`](../PRIVACY.md) (host the repo's raw URL) as your privacy policy,
   and justify the host permissions as "customizing captions on the listed video sites."

The same package installs on Opera and Edge (both accept Chrome MV3 zips; Opera
also has its own add-ons site).

## Notes

- `run_at: document_start` matches the userscript so the overlay attaches before
  the player initializes; `all_frames: true` lets it work inside embedded player
  iframes (e.g. a Vimeo/Wistia/Brightcove player embedded on another page).
- The content script runs in the isolated world and uses only DOM APIs
  (`video.textTracks`, `MutationObserver`, `localStorage`, …). If a site ever
  hides caption tracks from the isolated world, switch the content script to
  `"world": "MAIN"` in the manifest.
- The dev-only test suite under `../test/` is intentionally **not** part of this
  package, to keep the extension small.

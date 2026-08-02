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
patreon.com, youtube.com, youtube-nocookie.com, vimeo.com, streamable.com,
dailymotion.com, ted.com, twitch.tv, kick.com, wistia.com, wistia.net,
brightcove.net, floatplane.com, nebula.tv
```

On **YouTube** the overlay mirrors YouTube's own caption text; elsewhere it
activates when the player exposes native HTML5 WebVTT caption tracks. On a listed
site without captions it simply does nothing. Toggle any site on/off in the
**settings dashboard** (gear button on the toolbar, or the extension's Options
page).

**To add a curated site permanently:** append a match like `"*://*.example.com/*"`
to that `matches` array (add it to `../firefox-extension/manifest.json` too).
Avoid `*://*/*` — that triggers Chrome's "read and change data on all websites"
warning. Users can also add a site at runtime via the dashboard, which requests
access to that one site through `optional_host_permissions` (see Notes).

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
   cd chrome-extension && zip -r ../cyber-captions-customizer-chrome.zip . -x '*.DS_Store'
   ```
4. Upload the zip in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
5. For the **privacy** section: the extension collects no data — link
   [`../PRIVACY.md`](../PRIVACY.md) (host the repo's raw URL) as your privacy policy,
   and justify the host permissions as "customizing captions on the listed video sites."

The same package installs on Opera and Edge (both accept Chrome MV3 zips; Opera
also has its own add-ons site).

## Settings dashboard

`options.html` loads the packaged `content.js` in "panel mode" and renders the
same dashboard used by the on-video gear button. `background.js` opens it when
the toolbar icon is clicked, and re-registers any user-added custom sites the
user has already granted access to.

## Permissions

- `storage` — save the user's caption preferences (`chrome.storage.sync`).
- `scripting` + `optional_host_permissions` — used **only** when a user adds a
  custom site in the dashboard; Chrome prompts for that one site, then the
  content script is registered for it. Nothing is requested at install time.

## Notes

- `run_at: document_start` matches the userscript so the overlay attaches before
  the player initializes; `all_frames: true` lets it work inside embedded player
  iframes (e.g. a Vimeo/Wistia/Brightcove player embedded on another page).
- The content script runs in the isolated world and uses only DOM APIs plus
  `chrome.storage`. If a site ever hides caption tracks from the isolated world,
  switch the content script to `"world": "MAIN"` in the manifest.
- The dev-only test suite under `../test/` is intentionally **not** part of this
  package, to keep the extension small.

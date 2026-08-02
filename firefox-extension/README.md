# Firefox extension (MV3)

Manifest V3 build of **Video Streaming Caption Customizer** for Firefox.

> `content.js` and `icons/` are generated. Edit
> [`../src/caption-customizer.js`](../src/caption-customizer.js) and run
> `npm run build` from the repo root. `manifest.json`'s `version` is synced from
> the userscript header by the build.

## Which sites it runs on

The add-on requests access to a **curated list of video/streaming sites** (and
their embedded player frames) — **not** all websites. Current list in
`manifest.json` (`content_scripts[0].matches`):

```
patreon.com, vimeo.com, streamable.com, dailymotion.com, ted.com,
twitch.tv, kick.com, wistia.com, wistia.net, brightcove.net,
floatplane.com, nebula.tv
```

It activates only when a page's player exposes native HTML5 WebVTT caption
tracks. **To add a site:** append a match like `"*://*.example.com/*"` to that
`matches` array (add it to `../chrome-extension/manifest.json` too). Avoid
`*://*/*` — it triggers an all-sites permission warning and heavier review.

## Load temporarily (development)

1. Visit `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select this folder's `manifest.json`.
3. Open a video on a supported site, turn captions on, and customize.

Temporary add-ons are removed when Firefox restarts — reload as needed while
developing.

## Package for addons.mozilla.org (AMO)

1. From the repo root, run `npm run build`.
2. Replace the placeholder `icons/` with real 48/96/128 px PNG artwork.
3. Zip the **contents** of this folder:
   ```bash
   cd firefox-extension && zip -r ../cyber-captions-customizer-firefox.zip . -x '*.DS_Store'
   ```
4. Submit the zip at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
5. Data-collection disclosure: **none** — see [`../PRIVACY.md`](../PRIVACY.md).

## Notes

- `browser_specific_settings.gecko.id` is `video-streaming-caption-customizer@charlesmalo`
  — change it if you fork.
- `strict_min_version` is `115.0` (Firefox's MV3 baseline). Lower it only if you
  test on older releases.
- Uses only DOM APIs from the content-script context; host access is limited to
  the curated `matches` list above. `all_frames: true` lets it work inside
  embedded player iframes.
- The dev-only test suite under `../test/` is intentionally **not** part of this
  package.

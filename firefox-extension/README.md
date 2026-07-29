# Firefox extension (MV3)

Manifest V3 build of Patreon Caption Customizer for Firefox.

> `content.js` and `icons/` are generated. Edit
> [`../src/caption-customizer.js`](../src/caption-customizer.js) and run
> `npm run build` from the repo root. `manifest.json`'s `version` is synced from
> the userscript header by the build.

## Load temporarily (development)

1. Visit `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select this folder's `manifest.json`.
3. Open a Patreon video, turn captions on, and customize.

Temporary add-ons are removed when Firefox restarts — reload as needed while
developing.

## Package for addons.mozilla.org (AMO)

1. From the repo root, run `npm run build`.
2. Replace the placeholder `icons/` with real 48/96/128 px PNG artwork.
3. Zip the **contents** of this folder:
   ```bash
   cd firefox-extension && zip -r ../patreon-caption-customizer-firefox.zip . -x '*.DS_Store'
   ```
4. Submit the zip at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).

## Notes

- `browser_specific_settings.gecko.id` is set to
  `patreon-caption-customizer@charlesmalo` — change it if you fork.
- `strict_min_version` is `115.0` (Firefox's MV3 baseline). Lower it only if you
  test on older releases.
- Uses only DOM APIs from the content-script context; no host permissions beyond
  the `*.patreon.com` content-script match.
- The dev-only test suite under `../test/` is intentionally **not** part of this
  package.

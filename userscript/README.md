# Userscript — Tampermonkey / Greasemonkey

`cyber-captions-customizer.user.js` is the userscript build of **Video
Streaming Caption Customizer**.

> Generated file — do not edit. Change [`../src/caption-customizer.js`](../src/caption-customizer.js)
> (and [`userscript-header.txt`](userscript-header.txt) for `@version`, `@match`,
> name, or description), then run `npm run build` from the repo root. The
> `@match` block lists the supported streaming sites — add more there.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge/Opera/Safari)
   or [Violentmonkey](https://violentmonkey.github.io/) / Greasemonkey (Firefox).
2. Open `cyber-captions-customizer.user.js` in your browser (or drag it onto a
   tab) — the manager will prompt to install. Updates arrive when `@version` bumps.

## Publish to Greasy Fork

1. Sign in at [greasyfork.org](https://greasyfork.org) and choose **Post a script → Write a new script**.
2. Paste the contents of `cyber-captions-customizer.user.js`.
3. Set a real `@namespace` (a URL you own) in `userscript-header.txt` and rebuild
   before posting; add `@author` / `@license` if desired.
4. Greasy Fork parses the metadata block and hosts it with auto-update.

The `userscript-header.txt` metadata block is the single place to edit the name,
`@version`, `@description`, and `@match` — the build prepends it to the shared
source and also syncs the version into both extension manifests.

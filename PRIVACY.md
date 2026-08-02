# Privacy Policy — Video Streaming Caption Customizer

_Last updated: 2026._

**Short version: this tool collects nothing and sends nothing. Everything stays
in your browser.**

## What data is collected
**None.** The extension/userscript does not collect, store on a server, or
transmit any personal data, browsing history, analytics, or telemetry.

## What is stored, and where
Only your **display preferences** for the caption box — position, size, font
size, text color, background color and opacity, the auto-scroll toggle, which
sites you've enabled, any custom sites you've added, and your saved default
looks. These live under a single key (`ccc-settings-v3`) **on your own device**,
using the browser extension's `storage` area (which may sync across your own
signed-in browsers), the userscript manager's storage, or `localStorage` —
depending on how you installed it. They are used only to restore your chosen
look; nothing is sent anywhere.

You can clear them at any time via the toolbar's **Reset** button, the
dashboard's clear controls, or by clearing site/extension data in your browser.

## Network
The tool makes **no network requests**. It has no backend, no external services,
and loads no remote code.

## What the tool accesses on a page
To do its job it runs a content script on web pages and:
- reads the page's **native caption/subtitle text tracks** (the WebVTT cues the
  video player already exposes), or on **YouTube** the on-screen caption text,
  so it can re-render them, and
- adds its own caption overlay and hides the player's native caption rendering.

It does **not** read your form inputs, passwords, cookies, page text, or any
other content beyond the video's caption text, and it does not track which sites
or videos you watch.

## Permissions
- **Host access** is limited to a **specific list of video/streaming sites** (see
  the `matches` list in the manifest — e.g. YouTube, Patreon, Vimeo, Streamable,
  Dailymotion, TED, and a few others), plus their embedded player frames. The
  extension does **not** request access to all websites at install time.
- **`storage`** — to save your preferences on your device (see above).
- **`scripting`** + **optional host permissions** — used **only** if you add a
  custom site in the dashboard: the browser then prompts you to grant access to
  that one site so the overlay can run there. Nothing is requested until you opt
  in, and it's used solely for the caption functionality — never to collect or
  transmit data.

## Changes
Any changes to this policy will be committed to the project's public
repository.

## Contact
Questions or concerns: open an issue at
<https://github.com/charlesmalo/cyber-captions-customizer>.

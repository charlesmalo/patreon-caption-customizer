# Privacy Policy — Video Streaming Caption Customizer

_Last updated: 2026._

**Short version: this tool collects nothing and sends nothing. Everything stays
in your browser.**

## What data is collected
**None.** The extension/userscript does not collect, store on a server, or
transmit any personal data, browsing history, analytics, or telemetry.

## What is stored, and where
Only your **display preferences** for the caption box — position, size, font
size, text color, background color and opacity, and the auto-scroll toggle.
These are saved with the browser's `localStorage` API under a single key
(`patreon-caption-style-v2`) **on your own device**. They never leave your
browser and are used only to restore your chosen look on future videos.

You can clear them at any time via the toolbar's **Reset** button or by clearing
site data in your browser.

## Network
The tool makes **no network requests**. It has no backend, no external services,
and loads no remote code.

## What the tool accesses on a page
To do its job it runs a content script on web pages and:
- reads the page's **native caption/subtitle text tracks** (the WebVTT cues the
  video player already exposes) so it can re-render them, and
- adds its own caption overlay and hides the player's native caption rendering.

It does **not** read your form inputs, passwords, cookies, page text, or any
other content beyond the video's caption cues, and it does not track which sites
or videos you watch.

## Permissions
The tool requests access only to a **specific list of video/streaming sites**
(see the `matches` list in the manifest — e.g. Patreon, Vimeo, Streamable,
Dailymotion, TED, and a few others), plus their embedded player frames. It does
**not** request access to all websites. That access is used solely for the
caption functionality described above — not to collect or transmit data.

## Changes
Any changes to this policy will be committed to the project's public
repository.

## Contact
Questions or concerns: open an issue at
<https://github.com/charlesmalo/cyber-captions-customizer>.

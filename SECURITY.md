# Security Review — Video Streaming Caption Customizer

This document records a self-audit of the shipped code (the userscript and both
extensions, all generated from `src/caption-customizer.js`) against the criteria
that browser-extension scanners, antivirus tools, and human reviewers apply.

**Summary: the tool collects nothing, sends nothing, requests no dangerous
permissions, executes no dynamic or remote code, and ships readable,
unobfuscated source. It is safe and non-malicious.**

## Threat-model checklist

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | **No dynamic code execution** (`eval`, `new Function`, string `setTimeout`/`setInterval`, `document.write`) | ✅ Pass | The only `setTimeout` takes a **function** callback (the 1s toolbar close-delay), never a string. |
| 2 | **No network activity / exfiltration** (`fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`) | ✅ Pass | None present. The tool has no backend and makes zero requests. |
| 3 | **No remote code loading** (`<script src>`, `import()`, `importScripts`, `.src =`) | ✅ Pass | None present. |
| 4 | **No HTML-injection / XSS surface** (`innerHTML`, `outerHTML`, `insertAdjacentHTML`) | ✅ Pass | UI is built with `createElement`, `textContent`, `replaceChildren`. Caption text is rendered via the browser-native, sanitized `TextTrackCue.getCueAsHTML()`, with a plain-text fallback. |
| 5 | **No access to sensitive data** (cookies, passwords, credentials, form values) | ✅ Pass | No `document.cookie`; reads only the video's caption **text tracks**. |
| 6 | **No extension privilege APIs** (`chrome.*` / `browser.*`, messaging, tabs, storage, downloads) | ✅ Pass | Pure DOM content script — uses no extension APIs at all. |
| 7 | **Minimal manifest permissions** | ✅ Pass | Both manifests: `permissions=[]`, `host_permissions=[]`, no `web_accessible_resources`, no `background`, no CSP override. Access is a **curated content-script `matches` list** of video sites, not `<all_urls>`. |
| 8 | **No secrets/keys** (API keys, tokens, private keys, `.env`) | ✅ Pass | Repo-wide scan for AWS/GitHub/Stripe/Google keys, PEM blocks, and `.env`/`*.pem`/`*.key` files: none. |
| 9 | **No PII collected or stored** | ✅ Pass | Only a single `localStorage` key (`patreon-caption-style-v2`) holding display prefs (position %, size %, font px, colors, opacity, auto-scroll). No identifiers, no analytics. |
| 10 | **No telemetry / tracking / analytics** | ✅ Pass | No third-party scripts, pixels, or beacons. |
| 11 | **Not obfuscated / minified** | ✅ Pass | Fully readable source (longest line ~156 chars); shipped `content.js` is byte-identical to `src/caption-customizer.js` (verifiable). |
| 12 | **No dependencies (supply-chain surface)** | ✅ Pass | Zero runtime and build dependencies; `build.js` and the test harness use only Node's stdlib (`fs`, `path`, `zlib`). |
| 13 | **Single purpose** | ✅ Pass | Reposition/resize/recolor native captions on listed video sites — nothing else. |

## Data handling

- **Collected:** nothing.
- **Stored:** display preferences only, in `localStorage`, on the user's device.
- **Transmitted:** nothing. See [PRIVACY.md](PRIVACY.md).

## Permissions rationale (for reviewers)

- Content script matches a **curated list** of video/streaming sites (Patreon,
  Vimeo, Streamable, Dailymotion, TED, Twitch, Kick, Wistia, Brightcove,
  Floatplane, Nebula) — not all sites.
- `all_frames: true` is required so the overlay works inside **embedded player
  iframes** (e.g. a Vimeo/Wistia/Brightcove player embedded on another page).
  The iframe must still match the host list, so this does not widen site access.
- `run_at: document_start` lets the overlay attach before the player initializes.

## Notes / disclosures

- The **userscript** header includes an `@icon` that loads the project logo from
  the repo's public `raw.githubusercontent.com` URL (an image only; used by the
  userscript manager for display). The **extensions** bundle their icons
  locally and reference no external resources.
- The only personal data anywhere in the project is the **commit-author email in
  git history** (repository metadata, not in any shipped file), retained
  intentionally by the author.

## Reproduce this scan

```bash
# dynamic code / network / injection / privilege APIs
grep -nE 'eval\(|new Function|document\.write' src/caption-customizer.js
grep -nEi 'fetch\(|XMLHttpRequest|sendBeacon|WebSocket|importScripts|<script' src/caption-customizer.js
grep -nEi 'innerHTML|outerHTML|insertAdjacentHTML' src/caption-customizer.js
grep -nEi 'chrome\.[a-z]|browser\.[a-z]|postMessage' src/caption-customizer.js
# manifest permission surface
node -e 'const m=require("./chrome-extension/manifest.json");console.log(m.permissions,m.host_permissions,m.web_accessible_resources,m.background)'
# secrets sweep
grep -rInE 'AKIA[0-9A-Z]{16}|-----BEGIN|ghp_[0-9A-Za-z]{20,}|AIza[0-9A-Za-z_-]{35}' .
```

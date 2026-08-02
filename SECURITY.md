# Security Review — Video Streaming Caption Customizer

This document records a self-audit of the shipped code (the userscript and both
extensions, generated from `src/caption-customizer.js`, plus each extension's
static `options.html` and `background.js`) against the criteria that
browser-extension scanners, antivirus tools, and human reviewers apply.

**Summary: the tool collects nothing, sends nothing, executes no dynamic or
remote code, and ships readable, unobfuscated source. It uses only a small set
of standard, single-purpose extension APIs (`storage`, and `scripting` +
optional host access requested *only* when the user adds a custom site). It is
safe and non-malicious.**

## Threat-model checklist

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | **No dynamic code execution** (`eval`, `new Function`, string timers, `document.write`) | ✅ Pass | None in any shipped file. Timers take **function** callbacks only. (The dev-only `test/simulate.js` uses `eval` to load the source under a fake DOM; it is never shipped.) |
| 2 | **No network activity / exfiltration** (`fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`) | ✅ Pass | None present. The tool has no backend and makes zero requests. |
| 3 | **No remote code loading** (remote `<script src>`, `import()`, `importScripts`) | ✅ Pass | The only `<script src>` is `options.html` loading the **local, packaged** `content.js`. No remote code. |
| 4 | **No HTML-injection / XSS surface** (`innerHTML`, `outerHTML`, `insertAdjacentHTML`) | ✅ Pass | Entire UI (overlay + dashboard) is built with `createElement`, `textContent`, `createTextNode`, `replaceChildren`. Caption text is inserted as **plain text nodes** — no HTML parsing of page/caption content. |
| 5 | **No access to sensitive data** (cookies, passwords, credentials, form values) | ✅ Pass | No `document.cookie`, no reading of inputs/forms. Reads only the video's caption **text** (native tracks, or YouTube's on-screen caption DOM). |
| 6 | **Extension APIs limited to standard, single-purpose ones** | ✅ Pass | Only `storage` (save prefs), `storage.onChanged` (live-sync prefs), `runtime.openOptionsPage`/`action.onClicked` (open settings), and `permissions.request` + `scripting.registerContentScripts` (**only** inside "add a custom site"). No `tabs`, `webRequest`, `cookies`, `downloads`, `history`, `nativeMessaging`, or content-message channels. |
| 7 | **Conservative manifest permissions** | ✅ Pass | `permissions: ["storage","scripting"]`; **no** install-time `host_permissions`; `optional_host_permissions: ["*://*/*"]` is requested **only on explicit user action** (adding a custom site). Curated sites use a static content-script `matches` list, not `<all_urls>`. No `web_accessible_resources`, no CSP override. |
| 8 | **No secrets/keys** (API keys, tokens, private keys, `.env`) | ✅ Pass | Repo-wide scan for AWS/GitHub/Stripe/Google keys and PEM blocks: none (only this file's own grep pattern matches). No `.env`/`*.pem`/`*.key` files. |
| 9 | **No PII collected or stored** | ✅ Pass | One settings key (`ccc-settings-v3`) holding display prefs + site toggles + saved defaults. No identifiers, no analytics, no browsing history. |
| 10 | **No telemetry / tracking / analytics** | ✅ Pass | No third-party scripts, pixels, or beacons. |
| 11 | **Not obfuscated / minified** | ✅ Pass | Fully readable source; shipped `content.js` is `src/caption-customizer.js` with a one-line generated header (verifiable). |
| 12 | **No dependencies (supply-chain surface)** | ✅ Pass | Zero runtime and build dependencies; `build.js` and the test harness use only Node's stdlib (`fs`, `path`, `zlib`). |
| 13 | **Single purpose** | ✅ Pass | Reposition/resize/recolor captions on listed video sites (incl. YouTube) — nothing else. |

## Data handling

- **Collected:** nothing.
- **Stored:** display preferences, site toggles, custom-site list, and saved
  default looks — in the extension `storage` area / userscript storage /
  `localStorage`, on the user's device. Extension `storage.sync` may replicate
  across the user's own signed-in browsers; it is never sent to us.
- **Transmitted:** nothing. See [PRIVACY.md](PRIVACY.md).

## Permissions rationale (for reviewers)

- **Content-script host access** is a **curated list** of video/streaming sites
  (YouTube, Patreon, Vimeo, Streamable, Dailymotion, TED, Twitch, Kick, Wistia,
  Brightcove, Floatplane, Nebula) — not all sites.
- **`storage`** — persist the user's own caption preferences.
- **`scripting` + `optional_host_permissions`** — only exercised when the user
  explicitly adds a custom site in the dashboard. The browser then prompts for
  access to *that one site*; on grant, the content script is registered for it.
  Nothing is requested at install time. `background.js` re-registers only sites
  the user has already granted (`permissions.contains` gate).
- **`all_frames: true`** — so the overlay works inside **embedded player
  iframes**; the iframe must still match the host list, so it doesn't widen
  access.
- **`run_at: document_start`** — attach before the player initializes.

## Notes / disclosures

- The source exposes a namespaced page global, `window.CaptionCustomizer`
  (`settings`, `resolveStyle`, `openPanel`, `mountPanel`, `refresh`), used by the
  options page and the test harness. It carries **no secrets** and only reads or
  changes the user's own caption preferences.
- The **userscript** header includes an `@icon` that loads the project logo from
  the repo's public `raw.githubusercontent.com` URL (an image only, for the
  userscript manager's display). The **extensions** bundle their icons locally
  and reference no external resources.
- The only personal data anywhere in the project is the **commit-author email in
  git history** (repository metadata, not in any shipped file), retained
  intentionally by the author.

## Reproduce this scan

```bash
SHIP='src chrome-extension/content.js chrome-extension/background.js chrome-extension/options.html firefox-extension/content.js firefox-extension/background.js firefox-extension/options.html'
# dynamic code / network / remote / injection
grep -rnE 'eval\(|new Function|document\.write' $SHIP
grep -rnEi 'fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\(' $SHIP
grep -rnEi 'innerHTML|outerHTML|insertAdjacentHTML' $SHIP
# extension API surface actually used
grep -rnoE 'chrome\.[a-zA-Z.]+' src/caption-customizer.js chrome-extension/background.js | sort -u
# manifest permission surface
node -e 'const m=require("./chrome-extension/manifest.json");console.log(JSON.stringify({permissions:m.permissions,optional_host_permissions:m.optional_host_permissions,host_permissions:m.host_permissions,background:m.background,war:m.web_accessible_resources}))'
# secrets sweep
grep -rInE 'AKIA[0-9A-Z]{16}|-----BEGIN|ghp_[0-9A-Za-z]{20,}|AIza[0-9A-Za-z_-]{35}' . --exclude-dir=.git
```

# Site coverage — verified in a real browser

Records which sites the overlay's **container detection** and **control-bar
stacking** were actually measured against, rather than assumed. Last surveyed
2026-08-08 against v3.1.0.

`sitBelowChrome()` resolves by one of two paths:

- **measured** — a selector in `KNOWN_CHROME_SEL` matched; the box takes the
  control bar's stacking level minus one.
- **anchor** — no known bar; the box ties the video's stacking level and is
  inserted immediately after it, so later-sibling chrome paints above.

## Verified working

| Site | Path | Control bar | Box z-index | Notes |
|---|---|---|---|---|
| YouTube | measured | `.ytp-chrome-bottom` z=59 | **58** | above the video layer (10) |
| Vimeo | measured | `.vp-player-ui-overlays` z=37 | **36** | video layer is `auto` |
| Streamable | measured | `.svp-controls` z=6 | **5** | also clears `svp-events-catcher` (4), so the caption stays draggable |
| Brightcove | measured | `.vjs-control-bar` z=1 | **0** | Video.js skin; covers Video.js sites generally |
| Dailymotion | anchor | none matched | **0** | after `video_view` (z=0); all chrome is `auto`, later siblings |
| Twitch | anchor | none matched | **0** | after `video-ref`; `player-controls` are later siblings |
| Kick | anchor | none matched | **0** | after `player-no-controls`; `z-controls` at 202 sit above |
| Wistia | anchor | none matched | **0** | container nests *inside* `w-chrome`; hit-tested — `w-bottom-bar` still wins the click |

Streamable additionally got the full interaction battery against the real
shipped build (fetched from this repo's raw GitHub URL and run live): hover
reveals only the handle, a stationary click opens the toolbar, a real drag does
not, the `×` and outside-click both close it, `pointercancel` clears drag state,
a touch `pointerleave` does **not** close the toolbar while a mouse one does, and
`elementFromPoint` over the timeline returns the player's control — not our box.

## Not verified

| Site | Why |
|---|---|
| Patreon | `patreon.com` is blocked by the browser tool's safety restrictions — could not load it at all. The project's namesake host remains unverified. |
| TED | Both `ted.com` and `embed.ted.com` render the player area blank under automation; no `<video>` ever appears. |
| Nebula, Floatplane | Subscription-only; no account available. |
| `youtube-nocookie.com` | Same code path as `youtube.com` (`isYouTube()` matches both), so it is covered by inference, not measurement. |

## Survey limitation

The browser automation only reaches domains on the Chrome extension's
permission allowlist. `plyr.io` returned *"Navigation to this domain is not
allowed"*, and `patreon.com` *"not allowed due to safety restrictions"*. Broader
top-100 coverage needs those site permissions granted in the Claude in Chrome
extension first.

## Not supportable regardless of stacking

The overlay needs captions from **native WebVTT text tracks** or **YouTube's
caption DOM**. A site whose player renders captions from a private data channel
cannot be mirrored no matter how the stacking resolves.

- **Rumble** (`rumble.com`, not a matched host): container `videoPlayer-Rumble-cls`
  resolves, but the sampled video exposed **0** native caption tracks. Its video
  wrapper also has no later siblings, so the anchor path would place the box last —
  the one shape the documented residual assumption in `AGENTS.md` warns about.
  Not worth adding without a caption source.
- **Twitch** and **Kick** live streams also exposed 0 native caption tracks. Their
  stacking is correct, so the overlay behaves, but live captions come from each
  platform's own channel rather than WebVTT.

A `0` in a caption-track count above reflects the *sampled video*, not
necessarily the site's ceiling — Vimeo's sample had 4 tracks, Streamable's had none.

# Known issues

No known issues.

## Resolved: `sitBelowChrome()`'s no-control-bar fallback was unsafe (found 2026-08-07, v3.1.0; fixed 2026-08-07)

`sitBelowChrome()` in `src/caption-customizer.js` drops the caption overlay below
the player's control bar so timeline clicks seek the video. Its third path — no
known control bar found — used to fall back to a constant, `CHROME_FALLBACK_Z =
20`, which was measured safe on Vimeo/YouTube but wrong for genuinely unknown
players (e.g. Streamable, Dailymotion), where it could sit above the real control
chrome and make the timeline unclickable.

The fix (branch `fix/fallback-stacking`) replaces the constant with an anchor to
the `<video>` itself: walk up from the video to the direct child of `container`
on that path (`vTop`; may be the video itself), tie the box's z-index to vTop's
computed level, and insert the box immediately after vTop in tree order. The box
then paints above the video while every other piece of player chrome — a later
sibling, or one with a higher z-index — still paints above the box. The
recheck (attach / 1500ms / `refresh()`) is idempotent: it only touches the DOM
when the box isn't already exactly there. `CHROME_FALLBACK_Z` (20) is kept only
as a last resort for when no `<video>` can be located inside `container` at all.

Separately, `.svp-controls` (Streamable's control bar) was added to
`KNOWN_CHROME_SEL` so that host now takes the accurate measured path (6 → 5)
instead of the generic fallback.

See `test/simulate.js` (the "Stacking" section) for the regression coverage,
including Streamable- and Dailymotion-shaped scenarios asserting tree order.

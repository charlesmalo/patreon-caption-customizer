# Known issues

## `sitBelowChrome()`'s no-control-bar fallback is unsafe (found 2026-08-07, v3.1.0)

`sitBelowChrome()` in `src/caption-customizer.js` drops the caption overlay below
the player's control bar so timeline clicks seek the video. It has three paths:

1. **Known bar, numeric z-index > 0** → box z-index = that minus 1.
   Verified live and correct: Vimeo 37 → 36, YouTube 59 → 58.
2. **Known bar, `auto` or <= 0** → box z-index 0 plus `insertBefore(box, top)`
   so tree order decides. Correct.
3. **No known bar** → falls back to the constant `CHROME_FALLBACK_Z = 20`.
   **This path is broken.**

### Why path 3 is wrong

The constant 20 was chosen because it sits above the video and below the chrome
on Vimeo and YouTube — but neither host ever reaches the fallback, since both
match a known selector. For genuinely unknown players no single constant is safe.
Measured live in a browser on 2026-08-07:

| Host (matched) | Player container's direct children | Box at 20 |
|---|---|---|
| Streamable | `video` z=1, `svp-poster` 2, `svp-events-catcher` **4**, `svp-controls_bg` 2, `svp-controls` **6** | covers all of them — timeline still unclickable |
| Dailymotion | `video_view` z=0, everything else `auto` (tree order decides) | appended last, so covers all chrome |

This is not a regression — before v3.1.0 the box sat at z-index 2147483000 and
covered the controls everywhere. v3.1.0 fixes the hosts that match a known
selector and leaves the rest no worse. But the fallback does not deliver the fix.

### Planned remedy: anchor to the video instead of guessing a number

When no known control bar is found:

1. Walk up from the `<video>` to the direct child of `container` on that path
   (`vTop`; may be the video itself).
2. Read `vTop`'s computed z-index — numeric if it has one, else 0 — and use it
   for the box.
3. Insert the box immediately after `vTop`
   (`container.insertBefore(box, vTop.nextSibling)`; a null reference appends,
   which is correct when `vTop` is the last child).

The box then ties the video's stacking level but comes later in tree order, so it
paints above the video; and every piece of player chrome is either a later
sibling or has a higher z-index, so chrome paints above the box.

Checks against the measured cases:
- Streamable → box z-index 1, right after the video: above the video, below
  poster (2), events-catcher (4) and controls (6).
- Dailymotion → box z-index 0, right after `video_view`: above it, below all the
  later `auto` siblings.

Must be idempotent — `sitBelowChrome()` runs on attach, again at 1500ms, and on
every `refresh()`. Keep `CHROME_FALLBACK_Z` only as a last resort for when no
`<video>` can be located inside the container.

Separately, add `.svp-controls` (Streamable) to `KNOWN_CHROME_SEL` so that host
takes the accurate measured path (6 → 5) rather than the generic fallback.

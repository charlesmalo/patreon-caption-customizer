# Click-to-open toolbar + caption below the player's control bar

Date: 2026-08-07
Status: approved, ready for implementation
Touches: `src/caption-customizer.js` (single source of truth), `test/simulate.js`

## Problem

Two separate complaints about the overlay's interaction model:

1. **The toolbar opens on hover.** Moving the mouse across the caption pops the
   settings bar open unbidden. It should require a deliberate click.
2. **The caption box swallows clicks meant for the timeline.** `.pcr-box` renders
   at `z-index: 2147483000`, above every player's control chrome. When the caption
   sits low in the frame it covers the scrubber, so clicking to seek hits the
   caption instead of the timeline.

## Decisions taken

Confirmed with the user before design:

- Closing the toolbar: an `×` button, an outside click, **or** a 0.6s timeout after
  the pointer leaves. Clicking the caption a second time does *not* toggle it shut.
- Overlap behaviour: the caption goes genuinely **behind** the control bar (true
  z-order), rather than staying readable on top with click-through.
- The **resize handle stays on hover.** Only the toolbar waits for a click.

## Part 1 — Split hover state from open state

Today one flag (`open`) drives both the toolbar and the resize handle, and it is
set by `pointerenter`. These become two independent states:

| State | Set by | Reveals |
|---|---|---|
| `hovering` / `.pcr-hover` | `pointerenter` / `pointerleave` | `.pcr-handle` |
| `open` / `.pcr-open` | click on the box | `.pcr-bar` (and the handle) |

CSS changes from:

```css
.pcr-box.pcr-open .pcr-handle{display:block;}
```

to reveal the handle under either state, while `.pcr-bar` stays gated on
`.pcr-open` alone.

`visible()` currently keeps the box on screen while `open`; it must also do so
while `hovering`, so the box does not vanish out from under a resize drag when the
caption text clears mid-gesture.

### Click vs drag

A drag ends in a click, so opening the toolbar on a naive `click` listener would
pop it open on every reposition. The existing `pointerdown` handler already owns
the gesture, so detection lives there: record the pointer's start position, and on
`pointerup` treat a total travel of **< 4px** as a click-to-open. Anything further
is a drag and opens nothing.

The handler's existing early-return for events originating inside `.pcr-bar` or
`.pcr-handle` is retained, so toolbar controls and the resize corner never trigger
open.

### Closing

Three paths, all setting `open = false`:

1. **`×` button** — a new `.pcr-btn.pcr-close` appended to the existing
   `.pcr-actions` row alongside ⚙ and Reset.
2. **Outside click** — a **single module-level** `pointerdown` listener on
   `document` that closes every registered overlay whose box does not contain the
   event target. It must be module-level, not per-overlay: overlays are created per
   `<video>` and never unregistered, so a per-overlay document listener would
   accumulate across SPA video swaps. The existing `overlays` set gains a
   `closeBar(target)` member alongside `refresh()`.
3. **0.6s after `pointerleave`** — reuses the existing `hoverTimer`, retimed from
   1000ms to 600ms. Re-entering the box cancels it.

## Part 2 — Sit below the control bar

A single hardcoded z-index cannot serve every player. Measured live:

| Player | video layer | control bar layer |
|---|---|---|
| Vimeo | `auto` (video wrapper) | **37** (`.vp-player-ui-overlays`) |
| YouTube | **10** (`.html5-video-container`) | **59** (`.ytp-chrome-bottom`) |

Vimeo needs a value >0 and <37; YouTube needs >10 and <59. A constant like 20
satisfies both by luck but would still paint over Plyr's controls (z-index 3).

So the value is **measured at runtime**, mirroring the known-selector pattern the
native-caption fix already established:

```
KNOWN_CHROME_SEL = .ytp-chrome-bottom, .vp-player-ui-overlays, .vp-controls,
                   .vjs-control-bar, .jw-controls, .plyr__controls,
                   .shaka-bottom-controls
```

`sitBelowChrome()`:

1. Find a control bar inside `container` via `KNOWN_CHROME_SEL`.
2. Walk up from it to the **direct child of `container`** on that path — this is the
   element our box actually competes with in the stacking order.
3. Read that element's computed `z-index`; set `box.style.zIndex` to one below it,
   floored at 0.
4. If no control bar is found, fall back to **20** (verified above the video and
   below the chrome on both YouTube and Vimeo).

The static `z-index: 2147483000` is removed from the `.pcr-box` CSS rule, since the
value now comes from the inline style.

Control chrome frequently mounts after the video, so this runs on attach, once
again on a short delay, and on every `refresh()`.

### Accepted consequence

When the control bar is visible and overlaps the caption, the caption is covered
and cannot be clicked or dragged there. Player chrome auto-hides on idle, so the
caption becomes reachable again once the controls fade. This is the direct
consequence of the true-z-order choice and was accepted when it was made.

## Testing

New scenarios in `test/simulate.js`:

- A click (pointerdown → pointerup, no movement) opens the toolbar.
- A drag (>4px travel) repositions and leaves the toolbar closed.
- The `×` button closes it.
- An outside `pointerdown` closes it; a pointerdown inside the box does not.
- The 0.6s post-`pointerleave` timeout closes it, and re-entry cancels the timer.
- Hover alone reveals the handle but **not** the toolbar.
- Exactly one document-level pointerdown listener exists after many video swaps.
- z-index resolves below a YouTube-shaped (`.ytp-chrome-bottom` under a z-59 child)
  and a Vimeo-shaped (`.vp-player-ui-overlays`, z-37) control bar.
- z-index falls back to 20 when no control bar is present.

The fake DOM in `simulate.js` needs `getComputedStyle` to report a per-element
`zIndex` (currently a fixed stub) so the measurement is observable.

## Out of scope

- Detecting control bars that carry no recognizable class. The fallback constant
  covers them; a structural sniff like the caption fix's is not warranted, since a
  wrong guess here costs click priority rather than a visible defect.
- Keyboard dismissal (Esc). Not requested.

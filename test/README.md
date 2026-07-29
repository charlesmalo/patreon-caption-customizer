# Test suite (development only)

`simulate.js` is a dependency-free simulation and stress-test suite for the
shared source ([`../src/caption-customizer.js`](../src/caption-customizer.js)).

> This folder is **not** bundled into any userscript or extension artifact — it
> exists purely for development, to keep the shipped plugins small.

## Run

```bash
npm test          # from the repo root
# or:
node test/simulate.js
```

Exit code is non-zero if any assertion fails.

## What it does

It builds a minimal **fake DOM** with a deterministic virtual clock and
instrumented `setTimeout` / `requestAnimationFrame` / `MutationObserver`, then
runs the real source through realistic scenarios and asserts there are no
regressions in correctness, performance, or resource use.

Coverage includes:

- **Attach / lifecycle** — one overlay per player; re-scans don't duplicate it;
  a new video in the same container replaces (never stacks) the overlay.
- **Performance** — adding videos never triggers a full-document scan; thousands
  of benign mutations are batched, not processed per-node.
- **No infinite loops** — enabling captions flips the native track to `hidden`
  and terminates (bounded `change` events); mutation and timer "storm" guards
  throw if anything runs away.
- **No leaks** — 200 rapid caption changes never accumulate timers or rAF
  callbacks; the scroll chain is bounded and self-cancelling.
- **Behavior** — drag updates and persists position (and flips the toolbar),
  corner-resize changes font size, text/background color + opacity apply and
  persist, auto-scroll toggles correctly, and Reset restores defaults.
- **Memory** — overlay count stays at exactly one after 100 video swaps.

## Extending

Add a `test('...', () => { ... })` block in `simulate.js` for any new behavior.
The harness exposes helpers (`makeContainer`, `makeVideo`, `enableCaptions`,
`showCue`, `fire`, and the `clock`) to build scenarios without a real browser.

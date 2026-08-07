# Click-to-Open Toolbar + Caption Below Control Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the caption overlay's settings toolbar open on a deliberate click instead of hover, and drop the caption box below the video player's control bar so clicks on the timeline win.

**Architecture:** Split the single `open` flag into two independent states — `hovering` (reveals the resize handle) and `open` (reveals the toolbar). Click-vs-drag is disambiguated inside the existing `pointerdown` gesture by measuring pointer travel. The static `z-index: 2147483000` is replaced by a value measured at runtime from the player's own control bar.

**Tech Stack:** Vanilla ES2019 in a single IIFE. No dependencies, no bundler. Node stdlib only for build and tests.

## Global Constraints

- **All behavior lives in `src/caption-customizer.js`.** Never hand-edit `chrome-extension/content.js`, `firefox-extension/content.js`, or `userscript/cyber-captions-customizer.user.js` — they are generated and will be overwritten.
- Run `npm run verify` (syntax check + build + tests) before every commit. All tests must pass.
- **No dependencies.** Build and test use only `fs`, `path`, `zlib`.
- **The test suite must never be bundled** into a shipped artifact. It lives only in `test/`.
- Keep the source framework-free: only DOM/Web APIs available to a content script in the isolated world.
- Performance is a feature. Never introduce a full-document rescan; never add an unbounded per-cue DOM query.
- Read the spec at `docs/superpowers/specs/2026-08-07-click-toolbar-and-control-bar-z-order-design.md` before starting.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/caption-customizer.js` | Single source of truth — the whole IIFE | Modify: CSS block, state vars, pointer handlers, toolbar DOM, new `sitBelowChrome()`, module-level document listener |
| `test/simulate.js` | Fake-DOM simulation suite | Modify: `getComputedStyleMock` gains `zIndex`; new scenarios appended before the report block |
| `AGENTS.md` | Contributor/agent guidance | Modify: document the interaction model and z-order mechanism |

All product changes land in one file because that is this repo's golden rule. Tasks are split by behavior, not by file.

---

### Task 1: Split hover state from open state

Currently `pointerenter` sets `open = true`, which reveals both the resize handle and the toolbar. This task separates them: hover reveals only the handle. Click-to-open arrives in Task 2, so after this task the toolbar becomes temporarily unreachable — that is expected and Task 2 restores it.

**Files:**
- Modify: `src/caption-customizer.js` (CSS block ~line 178-183; state vars ~line 320; `visible()` ~line 327; hover handlers ~line 499-507)
- Test: `test/simulate.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a module-local boolean `hovering` and CSS class `.pcr-hover` on the box element; `visible()` gains `hovering` as a keep-alive condition. Task 2 relies on `open` remaining a separate boolean and on `hoverTimer` still existing.

- [ ] **Step 1: Write the failing test**

Append to `test/simulate.js`, immediately before the `// ---- report` block near the end of the file:

```js
// ---- Interaction: hover reveals the handle, click reveals the toolbar -------
test('hover alone reveals the resize handle but not the toolbar', () => {
  locationMock.hostname = 'www.patreon.com';
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'hover me', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerenter');
  assert(box.classList.contains('pcr-hover'), 'hover state set');
  assert(!box.classList.contains('pcr-open'), 'toolbar stays closed on hover');
});

test('leaving the box clears the hover state after 0.6s', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'bye', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerenter');
  fire(box, 'pointerleave');
  clock.advance(500);
  assert(box.classList.contains('pcr-hover'), 'still hovered before 600ms');
  clock.advance(200);
  assert(!box.classList.contains('pcr-hover'), 'hover cleared after 600ms');
});

test('re-entering the box cancels the pending hover-out close', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'again', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerenter');
  fire(box, 'pointerleave');
  clock.advance(400);
  fire(box, 'pointerenter');
  clock.advance(500);
  assert(box.classList.contains('pcr-hover'), 're-entry cancelled the timer');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node test/simulate.js`
Expected: FAIL — three failures reading `hover state set`, `still hovered before 600ms`, `re-entry cancelled the timer`. The `.pcr-hover` class does not exist yet.

- [ ] **Step 3: Update the CSS so the handle follows hover or open**

In `src/caption-customizer.js`, replace this line:

```js
  .pcr-box.pcr-open .pcr-handle{display:block;}
```

with:

```js
  .pcr-box.pcr-hover .pcr-handle,.pcr-box.pcr-open .pcr-handle{display:block;}
```

Leave `.pcr-box.pcr-open .pcr-bar{display:flex;}` exactly as it is — the toolbar stays gated on `open` alone.

- [ ] **Step 4: Add the `hovering` state and rewrite the hover handlers**

Change the state declaration line from:

```js
    let ccOn = false, hasText = false, open = false, dragging = false, hoverTimer = null;
```

to:

```js
    let ccOn = false, hasText = false, open = false, hovering = false, dragging = false, hoverTimer = null;
```

Change `visible()` from:

```js
    const visible = () => box.classList.toggle('pcr-on', isCovered(host) && ccOn && (hasText || open || dragging));
```

to:

```js
    const visible = () => box.classList.toggle('pcr-on', isCovered(host) && ccOn && (hasText || open || hovering || dragging));
```

Replace the whole hover block (the `pointerenter` / `pointerleave` pair under the `// ---- Hover open/close with a 1s close delay` comment) with:

```js
    // ---- Hover reveals the resize handle; the toolbar waits for a click -----
    const HOVER_OUT_MS = 600;
    box.addEventListener('pointerenter', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      hovering = true; box.classList.add('pcr-hover'); visible();
    });
    box.addEventListener('pointerleave', () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        hovering = false; box.classList.remove('pcr-hover');
        open = false; box.classList.remove('pcr-open');
        visible();
      }, HOVER_OUT_MS);
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run verify`
Expected: PASS — all tests green. The pre-existing test `toolbar stays open ~1s after the mouse leaves (close delay)` will now FAIL because the delay changed from 1000ms to 600ms and hover no longer opens the toolbar. Update it to match the new model: rename it to `hover state persists ~0.6s after the mouse leaves` and assert on `pcr-hover` rather than `pcr-open`, advancing the clock past 600ms instead of 1000ms.

- [ ] **Step 6: Commit**

```bash
git add src/caption-customizer.js test/simulate.js chrome-extension/content.js firefox-extension/content.js userscript/cyber-captions-customizer.user.js
git commit -m "Split hover state from toolbar-open state

Hover now reveals only the resize handle via .pcr-hover; the toolbar stays
gated on .pcr-open, which nothing sets yet. Hover-out delay retimed from
1000ms to 600ms."
```

---

### Task 2: Open the toolbar on click, not on drag

**Files:**
- Modify: `src/caption-customizer.js` (drag `pointerdown` handler ~line 510-529)
- Test: `test/simulate.js`

**Interfaces:**
- Consumes: `hovering`, `open`, `visible()` from Task 1.
- Produces: click-to-open behavior. Task 3 relies on `open`/`.pcr-open` being settable this way, and on the 4px threshold constant `CLICK_SLOP`.

- [ ] **Step 1: Write the failing test**

Append to `test/simulate.js` after the Task 1 tests:

```js
test('a click on the caption opens the toolbar', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'click me', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerdown', { clientX: 100, clientY: 100, target: box });
  fire(box, 'pointerup', { clientX: 101, clientY: 100, target: box });
  assert(box.classList.contains('pcr-open'), 'toolbar opened on click');
});

test('a drag repositions without opening the toolbar', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'drag me', 1);
  const box = boxIn(c)[0];
  const before = readOverride('patreon.com').xPct;
  fire(box, 'pointerdown', { clientX: 100, clientY: 100, target: box });
  fire(box, 'pointermove', { clientX: 260, clientY: 190, target: box });
  fire(box, 'pointerup', { clientX: 260, clientY: 190, target: box });
  assert(!box.classList.contains('pcr-open'), 'drag did not open the toolbar');
  assert(readOverride('patreon.com').xPct !== before, 'drag still repositioned and persisted');
});

test('a click starting on a toolbar control does not re-open or drag', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'ctl', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerdown', { clientX: 100, clientY: 100, target: box });
  fire(box, 'pointerup', { clientX: 100, clientY: 100, target: box });
  const bar = findByClass(box, 'pcr-bar');
  const xPct = readOverride('patreon.com').xPct;
  fire(box, 'pointerdown', { clientX: 500, clientY: 500, target: bar });
  fire(box, 'pointerup', { clientX: 500, clientY: 500, target: bar });
  eq(readOverride('patreon.com').xPct, xPct, 'pointerdown inside the bar never dragged');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node test/simulate.js`
Expected: FAIL — `toolbar opened on click`. Nothing sets `open` yet.

- [ ] **Step 3: Add click detection to the drag gesture**

In `src/caption-customizer.js`, replace the entire drag `pointerdown` handler (the block under `// ---- Drag to reposition`) with:

```js
    // ---- Drag to reposition; a stationary press is a click that opens the bar
    const CLICK_SLOP = 4; // px of travel below which a press counts as a click
    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pcr-handle') || e.target.closest('.pcr-bar')) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = style.xPct / 100 * rect.width, cy = style.yPct / 100 * rect.height;
      const gx = e.clientX - rect.left - cx, gy = e.clientY - rect.top - cy;
      const startX = e.clientX, startY = e.clientY;
      let travelled = false;
      dragging = true; box.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (Math.abs(ev.clientX - startX) > CLICK_SLOP || Math.abs(ev.clientY - startY) > CLICK_SLOP) travelled = true;
        if (!travelled) return; // don't nudge the box on a jittery click
        style.xPct = clamp((ev.clientX - rect.left - gx) / rect.width * 100, 2, 98);
        style.yPct = clamp((ev.clientY - rect.top - gy) / rect.height * 100, 4, 96);
        place();
      };
      const up = () => {
        box.removeEventListener('pointermove', move);
        box.removeEventListener('pointerup', up);
        dragging = false;
        if (travelled) saveOverride(host, style);
        else { open = true; box.classList.add('pcr-open'); }
        visible();
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
    });
```

Note the behavior change beyond opening: a press that never exceeds `CLICK_SLOP` no longer writes a session override, so clicking the caption no longer persists a no-op position.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run verify`
Expected: PASS — all green.

- [ ] **Step 5: Commit**

```bash
git add src/caption-customizer.js test/simulate.js chrome-extension/content.js firefox-extension/content.js userscript/cyber-captions-customizer.user.js
git commit -m "Open the settings toolbar on click rather than hover

A press that travels less than 4px counts as a click and opens the bar; a
real drag repositions and persists as before, opening nothing."
```

---

### Task 3: Three ways to close the toolbar

Adds the `×` button and the shared outside-click listener. The 0.6s hover-out close already landed in Task 1.

**Files:**
- Modify: `src/caption-customizer.js` (module scope near `const overlays = new Set();` ~line 260; toolbar actions row ~line 310-313; overlay registration ~line 572)
- Test: `test/simulate.js`

**Interfaces:**
- Consumes: `open`, `visible()`, `box` from Tasks 1-2; the existing module-level `overlays` Set.
- Produces: each registered overlay object gains `closeBar(target)` alongside its existing `refresh()`. A single module-level `document` `pointerdown` listener calls it.

- [ ] **Step 1: Write the failing test**

Append to `test/simulate.js` after the Task 2 tests:

```js
test('the x button closes the toolbar', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'close me', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerdown', { clientX: 10, clientY: 10, target: box });
  fire(box, 'pointerup', { clientX: 10, clientY: 10, target: box });
  assert(box.classList.contains('pcr-open'), 'open first');
  const x = qsa(box, '.pcr-close')[0];
  assert(x, 'close button exists');
  fire(x, 'click');
  assert(!box.classList.contains('pcr-open'), 'x closed the toolbar');
});

test('a click outside the box closes the toolbar; inside does not', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'outside', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerdown', { clientX: 10, clientY: 10, target: box });
  fire(box, 'pointerup', { clientX: 10, clientY: 10, target: box });
  assert(box.classList.contains('pcr-open'), 'open first');
  fire(documentMock, 'pointerdown', { target: findByClass(box, 'pcr-scroll') });
  assert(box.classList.contains('pcr-open'), 'click inside the box kept it open');
  fire(documentMock, 'pointerdown', { target: ROOT });
  assert(!box.classList.contains('pcr-open'), 'click outside closed it');
});

test('the outside-click listener is registered once, not once per overlay', () => {
  const before = (documentMock._ev.pointerdown || []).length;
  for (let i = 0; i < 5; i++) { const c = makeContainer(); makeVideo(c); }
  eq((documentMock._ev.pointerdown || []).length, before, 'no extra document listeners per overlay');
});
```

- [ ] **Step 2: Make the fake document dispatchable and add `contains()`**

Two gaps in the harness block this task.

First, `documentMock` currently has **no** `addEventListener` at all, so the module-level listener added in Step 6 would throw. The tests above also call `fire(documentMock, 'pointerdown', ...)`, which needs the same `_ev` shape `fire()` expects. In `test/simulate.js`, add these three members to the `documentMock` object literal:

```js
  _ev: {},
  addEventListener(t, fn) { (this._ev[t] || (this._ev[t] = [])).push(fn); },
  removeEventListener(t, fn) { const a = this._ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
```

Second, `FakeElement` has no `contains()` method, which Step 5 depends on. Add it to the `FakeElement` class alongside the existing `closest()`:

```js
  contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
```

This matches the real DOM's semantics, where an element contains itself.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node test/simulate.js`
Expected: FAIL — `close button exists` (no `.pcr-close` yet) and `click outside closed it`.

- [ ] **Step 4: Add the close button to the toolbar**

In `src/caption-customizer.js`, change the actions row from:

```js
    const reset = el('button', 'pcr-btn pcr-reset'); reset.type = 'button'; reset.textContent = 'Reset';
    actions.append(gear, reset);
```

to:

```js
    const reset = el('button', 'pcr-btn pcr-reset'); reset.type = 'button'; reset.textContent = 'Reset';
    const closeBtn = el('button', 'pcr-btn pcr-close'); closeBtn.type = 'button'; closeBtn.textContent = '×'; closeBtn.title = 'Close';
    actions.append(gear, reset, closeBtn);
```

Add a `closeBar` helper next to the hover handlers, and wire the button to it. Place this immediately after the `pointerleave` handler from Task 1:

```js
    const closeBar = () => {
      if (!open) return;
      open = false; box.classList.remove('pcr-open'); visible();
    };
    closeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeBar(); });
```

- [ ] **Step 5: Register the overlay's close hook**

Extend the object passed to `overlays.add({...})` (~line 572) so it carries a close hook alongside `refresh()`. Add this member:

```js
      closeBar(target) { if (!box.contains(target)) closeBar(); },
```

- [ ] **Step 6: Add the single module-level outside-click listener**

In `src/caption-customizer.js`, immediately after:

```js
  const overlays = new Set();
  const refreshAll = () => overlays.forEach((o) => o.refresh());
```

add:

```js
  // One document listener for every overlay: overlays are created per <video>
  // and never unregistered, so a per-overlay listener would accumulate across
  // SPA video swaps.
  if (!PANEL_MODE) {
    document.addEventListener('pointerdown', (e) => {
      overlays.forEach((o) => { if (o.closeBar) o.closeBar(e.target); });
    }, true);
  }
```

The `true` (capture) is deliberate: it fires before the box's own `pointerdown`, and the `box.contains(target)` guard is what protects clicks landing inside the overlay.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run verify`
Expected: PASS — all green.

- [ ] **Step 8: Commit**

```bash
git add src/caption-customizer.js test/simulate.js chrome-extension/content.js firefox-extension/content.js userscript/cyber-captions-customizer.user.js
git commit -m "Close the toolbar via x button or an outside click

Adds a close button to the actions row and one module-level document
pointerdown listener shared by all overlays, so the listener count stays
flat across SPA video swaps."
```

---

### Task 4: Sit below the player's control bar

**Files:**
- Modify: `src/caption-customizer.js` (CSS `.pcr-box` rule ~line 167; new constants near `KNOWN_NATIVE_SEL` ~line 60; new `sitBelowChrome()` inside `attach()`; `refresh()` ~line 572)
- Test: `test/simulate.js`

**Interfaces:**
- Consumes: `container`, `box` from `attach()`.
- Produces: `sitBelowChrome()`, called on attach, on a 1500ms delay, and from `refresh()`. Module constants `KNOWN_CHROME_SEL` (string) and `CHROME_FALLBACK_Z` (number, 20).

- [ ] **Step 1: Teach the fake DOM to report z-index**

In `test/simulate.js`, replace `getComputedStyleMock` with:

```js
const getComputedStyleMock = (el) => ({
  position: (el.style && el.style.position) || 'static',
  lineHeight: (el.style && el.style.lineHeight) || '28.6px', // 22px * 1.3
  zIndex: (el.style && el.style.zIndex) || 'auto',
});
```

- [ ] **Step 2: Write the failing test**

Append to `test/simulate.js` after the Task 3 tests:

```js
// ---- Stacking: the caption must lose click priority to the control bar -----
const makeChrome = (container, barCls, wrapperZ) => {
  const wrap = documentMock.createElement('div');
  wrap.style.zIndex = String(wrapperZ);
  const bar = documentMock.createElement('div');
  bar.className = barCls;
  wrap.appendChild(bar);
  container.appendChild(wrap);
  flushMutations();
  return bar;
};

test('caption sits one level below a YouTube-shaped control bar', () => {
  const c = makeContainer();
  makeChrome(c, 'ytp-chrome-bottom', 59);
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  eq(boxIn(c)[0].style.zIndex, '58', 'one below the chrome layer');
});

test('caption sits one level below a Vimeo-shaped control bar', () => {
  const c = makeContainer();
  makeChrome(c, 'vp-controls', 37);
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  eq(boxIn(c)[0].style.zIndex, '36', 'one below the chrome layer');
});

test('caption falls back to a safe z-index when no control bar is found', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  eq(boxIn(c)[0].style.zIndex, '20', 'fallback applied');
});

test('a control bar at z-index 0 never pushes the caption negative', () => {
  const c = makeContainer();
  makeChrome(c, 'plyr__controls', 0);
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  eq(boxIn(c)[0].style.zIndex, '0', 'floored at zero');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node test/simulate.js`
Expected: FAIL — all four, `one below the chrome layer` etc. `box.style.zIndex` is empty; the value is still baked into the CSS rule.

- [ ] **Step 4: Remove the static z-index from the CSS**

In `src/caption-customizer.js`, change the `.pcr-box` rule from:

```js
  .pcr-box{position:absolute;z-index:2147483000;transform:translate(-50%,-50%);
```

to:

```js
  .pcr-box{position:absolute;transform:translate(-50%,-50%);
```

Leave every other declaration in that rule untouched. The z-index now comes from the inline style set by `sitBelowChrome()`.

- [ ] **Step 5: Add the chrome selector constants**

In `src/caption-customizer.js`, immediately after the `NATIVE_SNIFF_TRIES` constant, add:

```js
  // The player's own control chrome. Our overlay must stack BELOW this so that
  // clicks on the timeline reach the player instead of the caption box.
  const KNOWN_CHROME_SEL = '.ytp-chrome-bottom,.vp-player-ui-overlays,.vp-controls,'
    + '.vjs-control-bar,.jw-controls,.plyr__controls,.shaka-bottom-controls';
  const CHROME_FALLBACK_Z = 20; // above the video layer, below chrome, on every player measured
```

- [ ] **Step 6: Implement `sitBelowChrome()`**

In `src/caption-customizer.js`, inside `attach()`, add this immediately after the `hideNative` definition:

```js
    // Stack just under the player's control bar. A single hardcoded value can't
    // work: measured live, Vimeo's controls sit at 37 over an `auto` video layer
    // while YouTube's sit at 59 over 10. So read the real layer and go one below.
    const sitBelowChrome = () => {
      const bar = one(container, KNOWN_CHROME_SEL);
      let z = CHROME_FALLBACK_Z;
      if (bar) {
        // Walk up to the direct child of container — that's what we stack against.
        let top = bar;
        while (top.parentElement && top.parentElement !== container) top = top.parentElement;
        const raw = parseInt(getComputedStyle(top).zIndex, 10);
        if (!isNaN(raw)) z = raw - 1;
      }
      box.style.zIndex = String(Math.max(0, z));
    };
```

- [ ] **Step 7: Call it on attach, on a delay, and on refresh**

Control chrome often mounts after the video, so measure more than once. Immediately after the `container.appendChild(box);` line, add:

```js
    sitBelowChrome();
    setTimeout(sitBelowChrome, 1500); // controls often mount after the video
```

Then add `sitBelowChrome();` to the `refresh()` body in the `overlays.add({...})` object, right after the existing `hideNative(null);` call.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run verify`
Expected: PASS — all green.

- [ ] **Step 9: Commit**

```bash
git add src/caption-customizer.js test/simulate.js chrome-extension/content.js firefox-extension/content.js userscript/cyber-captions-customizer.user.js
git commit -m "Stack the caption below the player's control bar

Replaces the fixed z-index 2147483000 with a value measured from the
player's own control chrome, so clicks on the timeline reach the player.
Falls back to 20 when no known control bar is present."
```

---

### Task 5: Document the new interaction model

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: everything from Tasks 1-4. Produces nothing consumed by later tasks.

- [ ] **Step 1: Update the mechanism section**

In `AGENTS.md`, find the paragraph in "How it works (mechanism)" that reads:

```
The overlay renders `lines: string[]` and the user can drag it, resize the
container (corner handle), restyle it (font + text/background color + opacity in
the toolbar), and optionally auto-scroll. Live edits persist as the current
site's session override; the gear button opens the settings dashboard.
```

Replace it with:

```
The overlay renders `lines: string[]` and the user can drag it, resize the
container (corner handle), restyle it (font + text/background color + opacity in
the toolbar), and optionally auto-scroll. Live edits persist as the current
site's session override; the gear button opens the settings dashboard.

**Interaction model.** Two independent states drive the chrome: `.pcr-hover`
(set on `pointerenter`) reveals only the resize handle, while `.pcr-open` reveals
the toolbar and is set *only* by a click — a press whose travel stays under
`CLICK_SLOP` (4px), detected inside the drag gesture so repositioning never pops
the bar open. The toolbar closes three ways: the `×` button, an outside click, or
`HOVER_OUT_MS` (600ms) after the pointer leaves. The outside-click listener is
registered **once at module scope** over the shared `overlays` set — overlays are
created per `<video>` and never unregistered, so a per-overlay document listener
would accumulate across SPA video swaps.

**Stacking.** `sitBelowChrome()` puts the overlay one level *below* the player's
control bar so clicks on the timeline reach the player rather than the caption.
The level is measured, not hardcoded: a single value can't serve every player
(Vimeo's controls sit at z-index 37 over an `auto` video layer; YouTube's at 59
over 10). It finds the control bar via `KNOWN_CHROME_SEL`, walks up to the direct
child of the container on that path, reads its computed z-index and subtracts one,
falling back to `CHROME_FALLBACK_Z` (20). Chrome often mounts after the video, so
it runs on attach, again after 1500ms, and on every `refresh()`. Consequence: where
the control bar overlaps the caption, the caption can't be clicked or dragged until
the chrome auto-hides.
```

- [ ] **Step 2: Verify and commit**

Run: `npm run verify`
Expected: PASS — no code changed, but confirms the tree is still green.

```bash
git add AGENTS.md
git commit -m "Document the click-to-open toolbar and control-bar stacking"
```

---

### Task 6: Verify in a real browser and ship

Unit tests run against a fake DOM. The z-index measurement in particular depends on real computed styles, so confirm on live players before releasing.

**Files:**
- Modify: `userscript/userscript-header.txt` (`@version`), `package.json` (`version`)

- [ ] **Step 1: Bump the version**

This is a behavior change, not a bugfix — bump the minor. Set `@version 3.1.0` in `userscript/userscript-header.txt` and `"version": "3.1.0"` in `package.json`. `build.js` syncs both extension manifests from the userscript header.

- [ ] **Step 2: Rebuild and verify**

Run: `npm run verify`
Expected: `Built v3.1.0`, all tests pass, and both manifests report 3.1.0.

- [ ] **Step 3: Load the extension and check a real player**

Load `chrome-extension/` as an unpacked extension, then on a Vimeo video with captions and a YouTube video with captions confirm:

1. Hovering the caption shows the corner resize handle but **not** the toolbar.
2. Clicking the caption opens the toolbar; dragging it does not.
3. The `×` button, a click elsewhere on the page, and moving the mouse away for 0.6s each close it.
4. With the control bar visible, clicking the timeline **seeks the video** rather than hitting the caption — the core fix.
5. Read the box's resolved z-index in DevTools and confirm it is one below the control bar's layer (58 on YouTube, 36 on Vimeo).

- [ ] **Step 4: Commit the version bump**

```bash
git add -A
git commit -m "v3.1.0: click-to-open toolbar, caption below the control bar"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Split hover state from open state | Task 1 |
| Handle stays on hover, toolbar on click | Task 1 (CSS), Task 2 (click) |
| `visible()` keeps box alive while hovering | Task 1 Step 4 |
| Click vs drag via 4px travel threshold | Task 2 Step 3 |
| `×` close button in the actions row | Task 3 Steps 4 |
| Outside click closes, single module-level listener | Task 3 Steps 5-6 |
| 0.6s post-`pointerleave` close | Task 1 Step 4 (`HOVER_OUT_MS`) |
| Remove static z-index; measure at runtime | Task 4 Steps 4, 6 |
| `KNOWN_CHROME_SEL` selector list | Task 4 Step 5 |
| Walk to direct child of container, subtract 1, floor at 0 | Task 4 Step 6 |
| Fallback constant 20 | Task 4 Steps 5, 6; tested Step 2 |
| Re-run on attach, delay, and refresh | Task 4 Step 7 |
| `getComputedStyle` mock reports `zIndex` | Task 4 Step 1 |
| All listed test scenarios | Tasks 1-4 test steps |
| Document the mechanism | Task 5 |

No gaps.

**Placeholder scan:** No TBD/TODO. Every code step carries literal code. No "similar to Task N" references.

**Type consistency:** `closeBar` names the overlay-object member (Task 3 Step 5) and the local helper (Step 4); the member delegates to the local — intentional, and the local is defined before the registration that closes over it. `sitBelowChrome`, `KNOWN_CHROME_SEL`, `CHROME_FALLBACK_Z`, `CLICK_SLOP`, `HOVER_OUT_MS`, `hovering` are each defined once and used consistently. `hideNative` and `one()` are pre-existing and used as they already exist.

**Harness gaps found and closed:** the plan's own code needed two fake-DOM APIs that do not exist yet — `documentMock.addEventListener` (absent entirely, would have thrown at Task 3 Step 6) and `FakeElement.contains()` (needed by Step 5). Both are added in Task 3 Step 2. `getComputedStyle` reporting `zIndex` is the third such gap, closed in Task 4 Step 1.

**Known interaction to watch during execution:** Task 1 Step 5 flags that the pre-existing test `toolbar stays open ~1s after the mouse leaves (close delay)` must be rewritten, not deleted — it is the only coverage of the hover-out timer.

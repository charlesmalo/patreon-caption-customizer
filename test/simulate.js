/**
 * Simulation / stress test suite for src/caption-customizer.js
 * ------------------------------------------------------------
 * Runs the real source against a lightweight fake DOM with a deterministic
 * virtual clock and instrumented timers / rAF / MutationObserver, so we can
 * assert there are no timer leaks, no runaway mutation scans, no infinite
 * track-mode (or YouTube self-trigger) loops, no overlay stacking, and no
 * crashes/stack overflows — plus the tiered settings model, YouTube mirroring,
 * the coverage gate, and the dashboard.
 *
 * Run:  node test/simulate.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- counters
const counters = {
  qsaDocument: 0, qsaElement: 0, moDeliveries: 0, trackChangeDispatched: 0,
};

// ------------------------------------------------------------- fake DOM core
const matchSel = (n, s) => {
  if (n.nodeType !== 1) return false;
  s = s.trim();
  if (s.includes(',')) return s.split(',').some((p) => matchSel(n, p));
  if (s === '*') return true;
  if (s[0] === '.') return (n._className || '').split(/\s+/).includes(s.slice(1));
  if (s.startsWith('[class*=')) {
    const m = s.match(/\[class\*="?([^"\]]+)"?\]/);
    return m ? (n._className || '').includes(m[1]) : false;
  }
  return n.tagName === s.toUpperCase();
};
const qsa = (el, sel) => {
  const out = [];
  if (sel.startsWith(':scope > ')) {
    const s = sel.slice(9);
    for (const c of el.childNodes) if (c.nodeType === 1 && matchSel(c, s)) out.push(c);
    return out;
  }
  const stack = [...el.childNodes];
  while (stack.length) {
    const n = stack.shift();
    if (n.nodeType !== 1) continue;
    if (matchSel(n, sel)) out.push(n);
    for (const c of n.childNodes) stack.push(c);
  }
  return out;
};

let ROOT = null;
const isConnected = (el) => { let n = el; while (n) { if (n === ROOT) return true; n = n.parentNode; } return false; };

// Mutation queue (delivered on flushMutations()).
let pending = [];
const record = (nodes) => { pending.push({ addedNodes: nodes.slice() }); };
const observers = [];
const flushMutations = () => {
  let guard = 0;
  while (pending.length) {
    const batch = pending; pending = [];
    counters.moDeliveries++;
    for (const o of observers) o.cb(batch);
    if (++guard > 10000) throw new Error('mutation storm (possible infinite loop)');
  }
};

class FakeText { constructor(t) { this.nodeType = 3; this.textContent = String(t); this.parentNode = null; } }

class FakeFragment {
  constructor() { this.nodeType = 11; this.childNodes = []; }
  appendChild(n) {
    if (n.nodeType === 11) { const k = n.childNodes.slice(); n.childNodes.length = 0; k.forEach((x) => this.appendChild(x)); return n; }
    if (n.parentNode) n.parentNode._remove(n);
    n.parentNode = this; this.childNodes.push(n); return n;
  }
  _remove(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1; this.tagName = tag.toUpperCase();
    this.childNodes = []; this.parentNode = null;
    this.style = {}; this._ev = {}; this._className = '';
    this._rect = null; this._scrollHeight = 0;
  }
  get className() { return this._className; }
  set className(v) { this._className = v || ''; }
  get classList() {
    const el = this;
    const read = () => new Set((el._className || '').split(/\s+/).filter(Boolean));
    const write = (s) => { el._className = [...s].join(' '); };
    return {
      add(c) { const s = read(); s.add(c); write(s); },
      remove(c) { const s = read(); s.delete(c); write(s); },
      contains(c) { return read().has(c); },
      toggle(c, f) { const s = read(); const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); write(s); return on; },
    };
  }
  get textContent() { return this.childNodes.map((n) => n.textContent || '').join(''); }
  set textContent(v) { this.childNodes.slice().forEach((k) => this._remove(k)); if (v !== '' && v != null) this._adopt(new FakeText(String(v))); }
  get scrollHeight() { return this._scrollHeight || 0; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 && i + 1 < this.parentNode.childNodes.length ? this.parentNode.childNodes[i + 1] : null;
  }
  _adopt(node) {
    if (node.nodeType === 11) { const kids = node.childNodes.slice(); node.childNodes.length = 0; kids.forEach((k) => this._adopt(k)); return; }
    if (node.parentNode) node.parentNode._remove(node);
    node.parentNode = this; this.childNodes.push(node);
    if (isConnected(this)) record([node]);
  }
  _remove(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; }
  appendChild(node) { this._adopt(node); return node; }
  insertBefore(node, ref) {
    if (node.nodeType === 11) { const kids = node.childNodes.slice(); node.childNodes.length = 0; kids.forEach((k) => this.insertBefore(k, ref)); return node; }
    if (node.parentNode) node.parentNode._remove(node);
    node.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i >= 0) this.childNodes.splice(i, 0, node); else this.childNodes.push(node);
    if (isConnected(this)) record([node]);
    return node;
  }
  append(...args) { for (const a of args) this._adopt(typeof a === 'string' ? new FakeText(a) : a); }
  replaceChildren(...args) { this.childNodes.slice().forEach((k) => this._remove(k)); if (args.length) this.append(...args); }
  remove() { if (this.parentNode) this.parentNode._remove(this); }
  querySelectorAll(sel) { counters.qsaElement++; return qsa(this, sel); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (matchSel(n, sel)) return n; n = n.parentNode; } return null; }
  addEventListener(t, fn) { (this._ev[t] || (this._ev[t] = [])).push(fn); }
  removeEventListener(t, fn) { const a = this._ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return this._rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}

// ------------------------------------------------------------- document/env
ROOT = new FakeElement('html');
const HEAD = new FakeElement('head');
ROOT.appendChild(HEAD);
pending = []; // discard setup mutations

const documentMock = {
  documentElement: ROOT,
  head: HEAD,
  activeElement: null,
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (t) => new FakeText(t),
  createDocumentFragment: () => new FakeFragment(),
  querySelectorAll: (sel) => { counters.qsaDocument++; return qsa(ROOT, sel); },
  _ev: {},
  addEventListener(t, fn) { (this._ev[t] || (this._ev[t] = [])).push(fn); },
  removeEventListener(t, fn) { const a = this._ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
};

const localStorageMock = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
})();

const getComputedStyleMock = (el) => ({
  position: (el.style && el.style.position) || 'static',
  lineHeight: (el.style && el.style.lineHeight) || '28.6px', // 22px * 1.3
  zIndex: (el.style && el.style.zIndex) || 'auto',
});

// ----------------------------------------------------------- virtual clock
let now = 0, tid = 1, rid = 1;
const timers = new Map();
const rafs = new Map();
const setTimeoutMock = (fn, ms) => { const id = tid++; timers.set(id, { fn, due: now + (ms || 0) }); return id; };
const clearTimeoutMock = (id) => { timers.delete(id); };
const rafMock = (fn) => { const id = rid++; rafs.set(id, fn); return id; };
const cafMock = (id) => { rafs.delete(id); };
const clock = {
  flushRaf() { const cbs = [...rafs.values()]; rafs.clear(); cbs.forEach((fn) => fn(now)); },
  tick(ms) {
    now += ms;
    let guard = 0;
    for (;;) {
      let ran = false;
      for (const [id, t] of [...timers.entries()]) if (t.due <= now) { timers.delete(id); t.fn(); ran = true; }
      if (!ran) break;
      if (++guard > 100000) throw new Error('timer storm (possible infinite loop)');
    }
  },
  pendingTimers: () => timers.size,
  pendingRaf: () => rafs.size,
};

class MutationObserverMock {
  constructor(cb) { this.cb = cb; }
  observe() { observers.push({ cb: this.cb }); }
  disconnect() { const i = observers.findIndex((o) => o.cb === this.cb); if (i >= 0) observers.splice(i, 1); }
}

// --------------------------------------------------- install globals + load
const locationMock = { hostname: 'www.patreon.com', href: 'https://www.patreon.com/posts/1', protocol: 'https:' };
global.window = global; // so the source's `window.CaptionCustomizer` API is reachable
Object.assign(global, {
  document: documentMock,
  localStorage: localStorageMock,
  location: locationMock,
  getComputedStyle: getComputedStyleMock,
  requestAnimationFrame: rafMock,
  cancelAnimationFrame: cafMock,
  setTimeout: setTimeoutMock,
  clearTimeout: clearTimeoutMock,
  MutationObserver: MutationObserverMock,
});
// Note: `chrome` and the GM_* functions are intentionally left undefined, so the
// storage abstraction falls back to localStorage (synchronous) for the harness.

// Seed the pre-v3 single-key format so we can assert the boot-time migration.
localStorageMock.setItem('patreon-caption-style-v2', JSON.stringify({ fontPx: 33, color: '#ABCDEF' }));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'caption-customizer.js'), 'utf8');
// eslint-disable-next-line no-eval
(0, eval)(SRC); // run the IIFE against our mocked globals
const CCC = global.CaptionCustomizer;

// ----------------------------------------------------------- test builders
const SETTINGS_KEY = 'ccc-settings-v3';
const LEGACY_KEY = 'patreon-caption-style-v2';
const readSettings = () => JSON.parse(localStorageMock.getItem(SETTINGS_KEY) || '{}');
const readOverride = (host) => (readSettings().overrides || {})[host || 'patreon.com'] || {};
// Back-compat alias for tests that assert live-edit persistence (now stored as
// the current host's session override rather than a single flat key).
const readLS = () => readOverride('patreon.com');

const makeContainer = () => {
  const c = documentMock.createElement('div');
  c.className = 'VideoPlayerRoot-module__test';
  c.style.position = 'static';
  c._rect = { left: 0, top: 0, width: 640, height: 360 };
  ROOT.appendChild(c);
  flushMutations();
  return c;
};
const makeTrackList = () => {
  const list = []; const ev = {};
  list.addEventListener = (t, fn) => { (ev[t] || (ev[t] = [])).push(fn); };
  list.removeEventListener = (t, fn) => { const a = ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  list.dispatchEvent = (t) => { if (t === 'change') counters.trackChangeDispatched++; (ev[t] || []).slice().forEach((fn) => fn({ type: t })); };
  return list;
};
const makeVideo = (container) => {
  const v = documentMock.createElement('video');
  v.textTracks = makeTrackList();
  container.appendChild(v);
  flushMutations();
  return v;
};
const addTrack = (list, kind) => {
  let mode = 'disabled'; const cev = {};
  const track = {
    kind, activeCues: null,
    get mode() { return mode; },
    set mode(v) { mode = v; list.dispatchEvent('change'); }, // real DOM fires change on set
    addEventListener: (t, fn) => { (cev[t] || (cev[t] = [])).push(fn); },
    dispatchCue: () => { (cev.cuechange || []).slice().forEach((fn) => fn({ type: 'cuechange' })); },
  };
  list.push(track);
  list.dispatchEvent('addtrack');
  return track;
};
const enableCaptions = (video) => { const t = addTrack(video.textTracks, 'captions'); t.mode = 'showing'; return t; };
const makeCue = (text) => ({ text, getCueAsHTML() { const f = new FakeFragment(); f.appendChild(new FakeText(text)); return f; } });
const findByClass = (el, cls) => {
  const stack = [el];
  while (stack.length) {
    const n = stack.shift();
    if (n.nodeType === 1 && (n._className || '').split(/\s+/).includes(cls)) return n;
    if (n.childNodes) for (const c of n.childNodes) stack.push(c);
  }
  return null;
};
const boxIn = (container) => qsa(container, '.pcr-box');
const scrollIn = (container) => findByClass(container, 'pcr-scroll');
const showCue = (container, track, text, lines) => {
  track.activeCues = [makeCue(text)];
  track.dispatchCue();
  const sc = scrollIn(container);
  if (sc) sc._scrollHeight = (lines || 1) * 28.6;
  clock.flushRaf();
};
const fire = (el, type, props = {}) => {
  const e = Object.assign({ type, target: el, pointerId: 1, preventDefault() {}, stopPropagation() {} }, props);
  (el._ev[type] || []).slice().forEach((fn) => fn(e));
};

// -------------------------------------------------------------- test runner
let pass = 0, fail = 0;
const log = [];
const test = (name, fn) => { try { fn(); pass++; log.push(`  ✓ ${name}`); } catch (e) { fail++; log.push(`  ✗ ${name}\n      ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > (tol || 0.5)) throw new Error(`${m || ''} expected ~${b} got ${a}`); };

// ================================================================= SCENARIOS

test('migrates the legacy single-key format into the patreon session override', () => {
  eq(readOverride('patreon.com').fontPx, 33, 'legacy fontPx migrated');
  eq(readOverride('patreon.com').textColor, '#ABCDEF', 'legacy color → textColor migrated');
  delete CCC.settings.overrides['patreon.com']; CCC.save(); // start later tests clean
});

test('script loaded and scanned the document exactly once at init', () => {
  eq(counters.qsaDocument, 1, 'init document scan count');
});

test('attaching a video creates exactly one overlay', () => {
  const c = makeContainer();
  makeVideo(c);
  eq(boxIn(c).length, 1, 'overlay count');
});

test('attaches generically on a container without a "player" class', () => {
  const c = documentMock.createElement('div');
  c.className = 'some-generic-wrapper';        // no "player" in the class name
  c.style.position = 'static';
  c._rect = { left: 0, top: 0, width: 640, height: 360 };
  ROOT.appendChild(c);
  flushMutations();
  const v = documentMock.createElement('video');
  v.textTracks = makeTrackList();
  c.appendChild(v);
  flushMutations();
  eq(qsa(c, '.pcr-box').length, 1, 'overlay attached via the video parent fallback');
});

test('re-scanning does not duplicate the overlay (video already seen)', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  // Simulate an unrelated mutation batch that re-reports the same video.
  record([v]); flushMutations();
  eq(boxIn(c).length, 1, 'overlay count after rescan');
});

test('a new video in the same container replaces the overlay (no stacking)', () => {
  const c = makeContainer();
  makeVideo(c);
  makeVideo(c); // second video in same container
  eq(boxIn(c).length, 1, 'overlay count after second video');
});

test('adding videos never triggers a full-document scan (perf)', () => {
  const before = counters.qsaDocument;
  const c = makeContainer();
  makeVideo(c); makeVideo(c);
  eq(counters.qsaDocument, before, 'no extra document scans');
});

test('enabling captions flips the track to hidden without an infinite loop', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const before = counters.trackChangeDispatched;
  const t = enableCaptions(v);
  eq(t.mode, 'hidden', 'track mode');
  assert(counters.trackChangeDispatched - before <= 4, 'change events bounded');
});

test('a short caption renders text and shows the box, no scroll timer', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  const before = clock.pendingTimers();
  showCue(c, t, 'hello world', 1);
  const box = boxIn(c)[0];
  assert(box.classList.contains('pcr-on'), 'box visible');
  eq(scrollIn(c).textContent, 'hello world', 'text rendered');
  eq(clock.pendingTimers(), before, 'no scroll timer for short caption');
});

test('a long caption scrolls a bounded number of steps then stops', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  clock.tick(1500); // let the per-overlay control-chrome recheck (Task 4) settle before baselining
  const before = clock.pendingTimers();
  showCue(c, t, 'a very long caption that spans five lines', 5);
  eq(clock.pendingTimers(), before + 1, 'one scroll timer scheduled');
  // Drain: 5 lines → 3 one-line advances.
  let advances = 0;
  for (let i = 0; i < 20 && clock.pendingTimers() > before; i++) { clock.tick(1300); advances++; }
  eq(clock.pendingTimers(), before, 'scroll chain terminated');
  assert(advances <= 5, 'advance count bounded');
  const sc = scrollIn(c);
  assert(/translateY\(-/.test(sc.style.transform), 'scrolled upward');
});

test('rapid caption changes never leak timers or rAF callbacks', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  clock.tick(1500); // let the per-overlay control-chrome recheck (Task 4) settle before baselining
  const baseT = clock.pendingTimers();
  const baseR = clock.pendingRaf();
  for (let i = 0; i < 200; i++) {
    showCue(c, t, `caption number ${i} that is quite long indeed`, 6);
    assert(clock.pendingTimers() <= baseT + 1, `timer leak at iter ${i}`);
    assert(clock.pendingRaf() <= baseR + 1, `rAF leak at iter ${i}`);
  }
  for (let i = 0; i < 50 && clock.pendingTimers() > baseT; i++) clock.tick(2000); // drain the chain
  eq(clock.pendingTimers(), baseT, 'all timers drained');
});

test('turning auto-scroll off shows full text and schedules no scroll', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  const box = boxIn(c)[0];
  const cb = box.querySelectorAll('input').find((i) => i.type === 'checkbox');
  cb.checked = false; fire(cb, 'change');
  assert(!box.classList.contains('pcr-scroll-on'), 'clip removed');
  const before = clock.pendingTimers();
  showCue(c, t, 'a very long caption that spans five lines', 5);
  eq(clock.pendingTimers(), before, 'no scroll timer when disabled');
  eq(readLS().autoscroll, false, 'persisted off');
  cb.checked = true; fire(cb, 'change'); // restore
});

test('disabling captions hides the box and clears any scroll timer', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  showCue(c, t, 'a very long caption that spans five lines', 5);
  t.mode = 'disabled';
  const box = boxIn(c)[0];
  assert(!box.classList.contains('pcr-on'), 'box hidden');
});

test('dragging updates position, flips the toolbar, and persists', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  enableCaptions(v);
  const box = boxIn(c)[0];
  fire(box, 'reset'); // no-op guard
  const rst = findByClass(box, 'pcr-reset');
  fire(rst, 'click'); // normalize to defaults (center=320,316.8)
  fire(box, 'pointerdown', { clientX: 320, clientY: 316.8 });
  fire(box, 'pointermove', { clientX: 64, clientY: 36 }); // → 10%,10% (top half)
  fire(box, 'pointerup', {});
  near(readLS().xPct, 10, 1, 'xPct persisted');
  near(readLS().yPct, 10, 1, 'yPct persisted');
  assert(box.classList.contains('pcr-flip'), 'toolbar flipped below (top half)');
});

test('corner-resize changes container width/height (free-form) and persists', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  enableCaptions(v);
  const box = boxIn(c)[0];
  fire(findByClass(box, 'pcr-reset'), 'click'); // widthPct=55, heightPct=16
  const handle = findByClass(box, 'pcr-handle');
  fire(handle, 'pointerdown', { clientX: 0, clientY: 0 });
  fire(handle, 'pointermove', { clientX: 64, clientY: 36 }); // +2*64/640*100=+20w, +2*36/360*100=+20h
  fire(handle, 'pointerup', {});
  near(readLS().widthPct, 75, 1, 'widthPct persisted');
  near(readLS().heightPct, 36, 1, 'heightPct persisted');
});

test('font slider changes the font size and persists', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  enableCaptions(v);
  const box = boxIn(c)[0];
  fire(findByClass(box, 'pcr-reset'), 'click');
  const font = box.querySelectorAll('input').find((i) => i.type === 'range' && i.max === '72');
  font.value = '40'; fire(font, 'input');
  eq(readLS().fontPx, 40, 'fontPx persisted');
  eq(box.style.fontSize, '40px', 'font applied');
});

test('text stays fully opaque; opacity slider only affects the background', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  enableCaptions(v);
  const box = boxIn(c)[0];
  const bgAlpha = box.querySelectorAll('input').find((i) => i.type === 'range' && i.max === '100');
  bgAlpha.value = '20'; fire(bgAlpha, 'input');
  assert(/,\s*1\)$/.test(box.style.color), `text opaque, got ${box.style.color}`);
  assert(/0?\.2\)$/.test(box.style.background), `bg at 0.2, got ${box.style.background}`);
  const inputs = box.querySelectorAll('input').filter((i) => i.type === 'range');
  eq(inputs.length, 2, 'exactly two sliders (font + background opacity), no text-opacity slider');
});

test('hover state persists ~0.6s after the mouse leaves', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  showCue(c, t, 'hello', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerenter');
  assert(box.classList.contains('pcr-hover'), 'hovers on pointerenter');
  fire(box, 'pointerleave');
  assert(box.classList.contains('pcr-hover'), 'still hovered immediately after leaving');
  clock.tick(600);
  assert(!box.classList.contains('pcr-hover'), 'hover cleared after 600ms');
});

test('color + opacity controls update the box and persist', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  enableCaptions(v);
  const box = boxIn(c)[0];
  const inputs = box.querySelectorAll('input');
  const colors = inputs.filter((i) => i.type === 'color');
  const ranges = inputs.filter((i) => i.type === 'range');
  colors[0].value = '#FF0000'; fire(colors[0], 'input');       // text color
  ranges[1].value = '50'; fire(ranges[1], 'input');            // background opacity
  assert(/255,\s*0,\s*0/.test(box.style.color), 'text color applied');
  assert(/rgba\(0,\s*0,\s*0,\s*0?\.5\)/.test(box.style.background), 'bg opacity applied');
  eq(readLS().textColor, '#FF0000', 'text color persisted');
  eq(readLS().bgAlpha, 0.5, 'bg alpha persisted');
});

test('reset clears the session override and restores the default look', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  enableCaptions(v);
  const box = boxIn(c)[0];
  const font = box.querySelectorAll('input').find((i) => i.type === 'range' && i.max === '72');
  font.value = '40'; fire(font, 'input');
  assert(Object.keys(readOverride('patreon.com')).length > 0, 'edit created a session override');
  fire(findByClass(box, 'pcr-reset'), 'click');
  eq(Object.keys(readOverride('patreon.com')).length, 0, 'override cleared on reset');
  eq(box.style.fontSize, '22px', 'font back to default');
  eq(box.style.width, '55%', 'width back to default');
  assert(/255,\s*255,\s*255/.test(box.style.color), 'text color back to white');
});

test('stress: 2000 benign mutations do not storm the observer or throw', () => {
  const before = counters.moDeliveries;
  for (let i = 0; i < 2000; i++) { const d = documentMock.createElement('div'); ROOT.appendChild(d); }
  flushMutations();
  assert(counters.moDeliveries - before <= 3, 'observer deliveries batched, not per-node');
});

test('memory: overlay count stays bounded after many video swaps', () => {
  const c = makeContainer();
  for (let i = 0; i < 100; i++) makeVideo(c);
  eq(boxIn(c).length, 1, 'exactly one overlay after 100 swaps');
});

// ---------------------------------------------------- YouTube + settings tier

const makeYTPlayer = () => {
  const p = documentMock.createElement('div');
  p.className = 'html5-video-player';
  p.style.position = 'static';
  p._rect = { left: 0, top: 0, width: 640, height: 360 };
  ROOT.appendChild(p); flushMutations();
  return p;
};
const makeYTVideo = (player) => {
  const v = documentMock.createElement('video');
  v.className = 'html5-main-video';
  player.appendChild(v); flushMutations();
  return v;
};
const setYTCaption = (player, lines) => {
  qsa(player, '.ytp-caption-window-container').forEach((n) => n.remove());
  // Always (re)append a container so the harness records an addition the observer
  // reacts to (the harness models added nodes, not removals). An empty container
  // — no visual lines — represents "caption cleared".
  const cont = documentMock.createElement('div'); cont.className = 'ytp-caption-window-container';
  const win = documentMock.createElement('div'); win.className = 'caption-window';
  cont.appendChild(win);
  (lines || []).forEach((t) => {
    const vl = documentMock.createElement('div'); vl.className = 'caption-visual-line';
    const seg = documentMock.createElement('span'); seg.className = 'ytp-caption-segment'; seg.textContent = t;
    vl.appendChild(seg); win.appendChild(vl);
  });
  player.appendChild(cont);
  flushMutations();
};

test('YouTube: mirrors the native caption DOM into our overlay and hides it', () => {
  locationMock.hostname = 'www.youtube.com';
  const p = makeYTPlayer();
  makeYTVideo(p);
  const box = qsa(p, '.pcr-box');
  eq(box.length, 1, 'overlay attached on YouTube');
  setYTCaption(p, ['hello from youtube']);
  eq(findByClass(p, 'pcr-scroll').textContent, 'hello from youtube', 'mirrored YT caption text');
  assert(box[0].classList.contains('pcr-on'), 'overlay visible while a caption is up');
  assert(p.classList.contains('pcr-hide-native'), "YouTube's own captions hidden");
  setYTCaption(p, []);
  assert(!box[0].classList.contains('pcr-on'), 'overlay hidden when caption clears');
  locationMock.hostname = 'www.patreon.com';
});

test('tiered resolution: builtin < global < platform < override', () => {
  CCC.settings.defaults.global = { fontPx: 30 };
  CCC.settings.defaults.platforms = { 'vimeo.com': { fontPx: 40 } };
  CCC.settings.overrides = {};
  eq(CCC.resolveStyle('vimeo.com').fontPx, 40, 'platform default beats global');
  eq(CCC.resolveStyle('nebula.tv').fontPx, 30, 'global applies where no platform default');
  eq(CCC.resolveStyle('nebula.tv').textColor, '#FFFFFF', 'builtin fills the rest');
  CCC.settings.overrides = { 'vimeo.com': { fontPx: 50 } };
  eq(CCC.resolveStyle('vimeo.com').fontPx, 50, 'session override wins over defaults');
  CCC.settings.defaults.global = {}; CCC.settings.defaults.platforms = {}; CCC.settings.overrides = {}; CCC.save();
});

test('coverage toggle hides then re-shows the overlay live (two-way)', () => {
  locationMock.hostname = 'www.patreon.com';
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  showCue(c, t, 'hi', 1);
  const box = boxIn(c)[0];
  assert(box.classList.contains('pcr-on'), 'visible while covered');
  CCC.settings.coverage['patreon.com'] = false; CCC.save(); CCC.refresh();
  assert(!box.classList.contains('pcr-on'), 'hidden when coverage turned off');
  eq(readSettings().coverage['patreon.com'], false, 'coverage persisted');
  CCC.settings.coverage['patreon.com'] = true; CCC.save(); CCC.refresh();
  assert(box.classList.contains('pcr-on'), 'visible again when re-enabled');
});

test('dashboard: editing a global default persists and updates live overlays', () => {
  locationMock.hostname = 'www.patreon.com';
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  showCue(c, t, 'hi', 1);
  const box = boxIn(c)[0];
  delete CCC.settings.overrides['patreon.com']; CCC.save(); CCC.refresh();
  CCC.openPanel();
  const modal = qsa(ROOT, '.ccc-modal')[0];
  assert(modal, 'dashboard opened');
  const scope = qsa(modal, 'select')[0];
  scope.value = 'global'; fire(scope, 'change');
  const nums = qsa(modal, 'input').filter((i) => i.type === 'number');
  nums[0].value = '48'; fire(nums[0], 'change'); // first number field = Font (px)
  eq(readSettings().defaults.global.fontPx, 48, 'global default persisted');
  eq(box.style.fontSize, '48px', 'overlay picked up the new default (no override present)');
  CCC.settings.defaults.global = {}; CCC.save(); CCC.refresh();
  fire(qsa(modal, '.ccc-x')[0], 'click'); // close
});

test('dashboard: adding a custom site records it and shows the as-is disclaimer', () => {
  CCC.openPanel();
  const modal = qsa(ROOT, '.ccc-modal')[0];
  const textInput = qsa(modal, 'input').find((i) => i.type === 'text');
  textInput.value = 'example.com';
  const addBtn = qsa(modal, '.ccc-btn').find((b) => b.textContent === 'Add site');
  fire(addBtn, 'click');
  assert(readSettings().customSites.includes('example.com'), 'custom site persisted');
  assert(findByClass(modal, 'ccc-note'), 'as-is disclaimer present');
  CCC.settings.customSites = []; CCC.save();
  fire(qsa(modal, '.ccc-x')[0], 'click'); // close
});

// ---- The player's OWN caption renderer must be suppressed too --------------
// Players like Vimeo, video.js, JW, Plyr and Shaka keep their text track at
// mode="hidden" and paint captions into their own DOM. Flipping the mode is a
// no-op for them, so without an explicit hide the user sees TWO caption boxes
// and can only move/style ours.
const addNativeCaps = (container, cls, txt) => {
  const n = documentMock.createElement('div');
  n.className = cls;
  n.textContent = txt;
  container.appendChild(n);
  flushMutations();
  return n;
};

test("a player's own caption DOM is hidden by class (Vimeo)", () => {
  locationMock.hostname = 'vimeo.com';
  const c = makeContainer();
  const v = makeVideo(c);
  addNativeCaps(c, 'vp-captions Captions_module_captions__5ed5b89b', 'doubled line');
  const t = enableCaptions(v);
  showCue(c, t, 'doubled line', 1);
  assert(c.classList.contains('pcr-hide-native'), "player's own captions hidden");
  eq(findByClass(c, 'pcr-scroll').textContent, 'doubled line', 'our overlay still renders');
  locationMock.hostname = 'www.patreon.com';
});

test('the same hide applies to video.js / JW / Plyr / Shaka style players', () => {
  for (const cls of ['vjs-text-track-display', 'jw-captions', 'plyr__captions', 'shaka-text-container']) {
    const c = makeContainer();
    const v = makeVideo(c);
    addNativeCaps(c, cls, 'line');
    showCue(c, enableCaptions(v), 'line', 1);
    assert(c.classList.contains('pcr-hide-native'), `hidden for .${cls}`);
  }
});

test('an unknown player\'s caption DOM is found structurally and tagged', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const own = addNativeCaps(c, 'mystery-player-subs', 'hello world');
  showCue(c, enableCaptions(v), 'hello world', 1);
  assert(own.classList.contains('pcr-native-cap'), 'unknown renderer tagged for hiding');
  assert(c.classList.contains('pcr-hide-native'), 'hide class on the container');
});

test('structural sniffing never tags our own overlay, the video, or the container', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'solo caption', 1);
  assert(!c.classList.contains('pcr-native-cap'), 'container not tagged');
  assert(!v.classList.contains('pcr-native-cap'), 'video not tagged');
  eq(qsa(c, '.pcr-native-cap').length, 0, 'nothing tagged when no rival renderer exists');
  eq(findByClass(c, 'pcr-scroll').textContent, 'solo caption', 'our overlay unaffected');
});

test('structural sniffing is bounded (no per-cue full-container rescan)', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  showCue(c, t, 'warmup', 1);
  const before = counters.qsaElement;
  for (let i = 0; i < 40; i++) showCue(c, t, 'cue ' + i, 1);
  const perCue = (counters.qsaElement - before) / 40;
  assert(perCue < 3, `bounded element queries per cue (got ${perCue})`);
});

test('turning coverage off restores the player\'s own captions', () => {
  locationMock.hostname = 'www.patreon.com';
  const c = makeContainer();
  const v = makeVideo(c);
  const own = addNativeCaps(c, 'vp-captions', 'native line');
  showCue(c, enableCaptions(v), 'native line', 1);
  assert(c.classList.contains('pcr-hide-native'), 'hidden while covered');
  CCC.settings.coverage['patreon.com'] = false; CCC.save(); CCC.refresh();
  assert(!c.classList.contains('pcr-hide-native'), 'restored when coverage is off');
  assert(!own.classList.contains('pcr-native-cap'), 'structural tag cleared too');
  CCC.settings.coverage['patreon.com'] = true; CCC.save(); CCC.refresh();
  assert(c.classList.contains('pcr-hide-native'), 're-hidden when coverage is back on');
});

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
  clock.tick(500);
  assert(box.classList.contains('pcr-hover'), 'still hovered before 600ms');
  clock.tick(200);
  assert(!box.classList.contains('pcr-hover'), 'hover cleared after 600ms');
});

test('a touch pointerleave does not arm the close timer, but a mouse one still does', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'touch', 1);
  const box = boxIn(c)[0];
  // Open the toolbar via a tap (click), as touch would.
  fire(box, 'pointerdown', { clientX: 10, clientY: 10, target: box, pointerType: 'touch' });
  fire(box, 'pointerup', { clientX: 10, clientY: 10, target: box, pointerType: 'touch' });
  assert(box.classList.contains('pcr-open'), 'tap opened the toolbar');
  // On touch, the UA fires pointerleave right after pointerup. It must NOT
  // arm the 600ms close timer, or the toolbar would close itself right after opening.
  fire(box, 'pointerleave', { pointerType: 'touch' });
  clock.tick(600);
  assert(box.classList.contains('pcr-open'), 'toolbar stays open after a touch pointerleave');
  // A real mouse pointerleave must still arm the timer as before.
  fire(box, 'pointerleave', { pointerType: 'mouse' });
  clock.tick(600);
  assert(!box.classList.contains('pcr-open'), 'toolbar closes after a mouse pointerleave + 600ms');
});

test('pointercancel during a drag clears dragging and removes the move/up listeners', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const t = enableCaptions(v);
  showCue(c, t, 'cancel me', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerdown', { clientX: 100, clientY: 100, target: box });
  fire(box, 'pointermove', { clientX: 200, clientY: 150, target: box }); // travel past the click threshold
  const moveCountBefore = (box._ev.pointermove || []).length;
  fire(box, 'pointercancel', { target: box });
  eq((box._ev.pointermove || []).length, moveCountBefore - 1, 'pointermove listener removed on cancel');
  eq((box._ev.pointerup || []).length, 0, 'pointerup listener removed on cancel');
  eq((box._ev.pointercancel || []).length, 0, 'pointercancel listener removed on cancel');
  // If `dragging` were left stuck true (the pre-fix bug), the box would stay
  // visible ('.pcr-on') forever even with no caption text. Prove it was cleared
  // by removing the caption and checking the box actually hides.
  t.mode = 'disabled';
  assert(!box.classList.contains('pcr-on'), 'box hides once the caption clears — dragging was not left stuck true');
});

test('pointercancel during a handle resize clears dragging and removes its listeners', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'resize cancel', 1);
  const box = boxIn(c)[0];
  const handle = findByClass(box, 'pcr-handle');
  fire(handle, 'pointerdown', { clientX: 0, clientY: 0 });
  const moveCountBefore = (handle._ev.pointermove || []).length;
  fire(handle, 'pointercancel', {});
  eq((handle._ev.pointermove || []).length, moveCountBefore - 1, 'pointermove listener removed on cancel');
  eq((handle._ev.pointerup || []).length, 0, 'pointerup listener removed on cancel');
  eq((handle._ev.pointercancel || []).length, 0, 'pointercancel listener removed on cancel');
});

test('re-entering the box cancels the pending hover-out close', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'again', 1);
  const box = boxIn(c)[0];
  fire(box, 'pointerenter');
  fire(box, 'pointerleave');
  clock.tick(400);
  fire(box, 'pointerenter');
  clock.tick(500);
  assert(box.classList.contains('pcr-hover'), 're-entry cancelled the timer');
});

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

test('a jittery press that never exceeds the threshold still counts as a click', () => {
  locationMock.hostname = 'www.patreon.com';
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'jitter', 1);
  const box = boxIn(c)[0];
  const before = readOverride('patreon.com').xPct;
  fire(box, 'pointerdown', { clientX: 100, clientY: 100, target: box });
  fire(box, 'pointermove', { clientX: 102, clientY: 101, target: box });
  fire(box, 'pointerup', { clientX: 102, clientY: 101, target: box });
  assert(box.classList.contains('pcr-open'), 'jittery sub-threshold move still opened the toolbar');
  eq(readOverride('patreon.com').xPct, before, 'jittery sub-threshold move did not persist an override');
});

test('several small incremental moves that accumulate past the threshold still count as a drag', () => {
  locationMock.hostname = 'www.patreon.com';
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'creep', 1);
  const box = boxIn(c)[0];
  const before = readOverride('patreon.com').xPct;
  fire(box, 'pointerdown', { clientX: 100, clientY: 100, target: box });
  fire(box, 'pointermove', { clientX: 102, clientY: 100, target: box });
  fire(box, 'pointermove', { clientX: 104, clientY: 100, target: box });
  fire(box, 'pointermove', { clientX: 106, clientY: 100, target: box });
  fire(box, 'pointermove', { clientX: 108, clientY: 100, target: box });
  fire(box, 'pointermove', { clientX: 110, clientY: 100, target: box });
  fire(box, 'pointerup', { clientX: 110, clientY: 100, target: box });
  assert(!box.classList.contains('pcr-open'), 'incremental creep past the threshold did not open the toolbar');
  assert(readOverride('patreon.com').xPct !== before, 'incremental creep past the threshold persisted as a drag');
});

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

test('with no known control bar but a video present, the box ties to the video\'s own z-index, not the old constant', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  const box = boxIn(c)[0];
  eq(box.style.zIndex, '0', 'z-index tied to the video (auto -> 0), not CHROME_FALLBACK_Z (20)');
  eq(v.nextSibling, box, 'box sits immediately after the video in tree order');
});

test('a control bar at z-index 0 is beaten by DOM tree order, not a floored z-index', () => {
  const c = makeContainer();
  const bar = makeChrome(c, 'plyr__controls', 0);
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  const box = boxIn(c)[0];
  // Flooring at 0 alone is a no-op (tie with the bar's own z-index 0, and tree
  // order would still paint the box last / on top). The box must actually be
  // moved before the chrome wrapper in the DOM so it paints underneath.
  eq(box.style.zIndex, '0', 'z-index set to 0');
  assert(box.nextSibling === bar.parentElement, 'box moved immediately before the chrome wrapper in tree order');
});

test('a control bar whose stacking ancestor has z-index:auto is beaten via DOM tree order', () => {
  const c = makeContainer();
  const bar = makeChrome(c, 'vjs-control-bar', 'auto'); // e.g. Video.js stock skin: no z-index set
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  const box = boxIn(c)[0];
  eq(box.style.zIndex, '0', 'z-index set to 0 (NaN cannot be used to decide order)');
  assert(box.nextSibling === bar.parentElement, 'box moved immediately before the chrome wrapper in tree order');
});

test('sitBelowChrome re-running against an auto/zero bar does not reshuffle the DOM (idempotent)', () => {
  const c = makeContainer();
  makeChrome(c, 'vjs-control-bar', 'auto');
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  const box = boxIn(c)[0];
  const before = c.childNodes.slice();
  clock.tick(1500); // triggers the second sitBelowChrome() call
  eq(c.childNodes.length, before.length, 'no nodes added or removed');
  eq(c.childNodes.indexOf(box), before.indexOf(box), 'box position unchanged on re-run');
});

// ---- Task-remedy: the no-control-bar fallback anchors to the video ---------

test('Streamable-shaped: no known control bar matches, so the box anchors to the video (not the old constant 20)', () => {
  const c = makeContainer();
  const v = makeVideo(c); // video z=1, direct child of container; attach fires now (order: [v, box])
  v.style.zIndex = '1';
  const box = boxIn(c)[0];
  // Chrome mounts AFTER the box already exists (the real-world race the 1500ms
  // recheck exists for), landing between the video and the box — the fallback
  // must move the box back to right after the video on the recheck.
  const catcher = documentMock.createElement('div'); catcher.style.zIndex = '4'; // full-bleed events catcher
  const controlsish = documentMock.createElement('div');
  controlsish.className = 'svp-fake-toolbar'; // deliberately NOT in KNOWN_CHROME_SEL -> forces the fallback path
  controlsish.style.zIndex = '6';
  c.insertBefore(catcher, box);
  c.insertBefore(controlsish, box); // order now: [v, catcher, controlsish, box]
  clock.tick(1500); // second sitBelowChrome() call
  eq(v.nextSibling, box, 'box ends up immediately after the video in tree order');
  eq(box.style.zIndex, '1', "z-index equals the video's level (1), not CHROME_FALLBACK_Z (20)");
});

test('Dailymotion-shaped: box lands right after the video_view wrapper with z-index 0', () => {
  const c = makeContainer();
  const wrap = documentMock.createElement('div');
  wrap.className = 'video_view';
  wrap.style.zIndex = '0';
  c.appendChild(wrap); flushMutations();
  const v = documentMock.createElement('video'); v.textTracks = makeTrackList();
  wrap.appendChild(v); flushMutations(); // attach fires; order in c: [wrap, box]
  const box = boxIn(c)[0];
  // Later chrome-ish siblings at z-index:auto mount after the box already exists.
  const sib1 = documentMock.createElement('div'); sib1.style.zIndex = 'auto';
  const sib2 = documentMock.createElement('div'); sib2.style.zIndex = 'auto';
  c.insertBefore(sib1, box);
  c.insertBefore(sib2, box); // order now: [wrap, sib1, sib2, box]
  clock.tick(1500); // second sitBelowChrome() call
  eq(wrap.nextSibling, box, 'box ends up immediately after the video_view wrapper in tree order');
  eq(box.style.zIndex, '0', "z-index equals the wrapper's level (0)");
});

test('the no-control-bar fallback is meaningfully idempotent: the recheck must not reshuffle or duplicate', () => {
  const c = makeContainer();
  const v = makeVideo(c); // attach fires; order: [v, box]
  const box = boxIn(c)[0];
  // A later, unrelated sibling mounts after the box (chrome mounting late) —
  // this is the shape that would expose a missing idempotence guard: an
  // unconditional container.insertBefore(box, box) would strip the box out
  // and re-append it, shoving it past this later sibling.
  const laterChrome = documentMock.createElement('div');
  laterChrome.className = 'not-a-known-chrome-class';
  laterChrome.style.zIndex = 'auto';
  c.appendChild(laterChrome); flushMutations(); // order: [v, box, laterChrome]
  const childCountBefore = c.childNodes.length;
  const posBefore = c.childNodes.indexOf(box);
  clock.tick(1500); // second sitBelowChrome() call — must be a no-op here
  eq(c.childNodes.length, childCountBefore, "no duplicate insertion (container's child count unchanged)");
  eq(c.childNodes.indexOf(box), posBefore, 'box position stable across the delayed re-measure');
});

test('.svp-controls now takes the measured path (Streamable is a known control bar)', () => {
  const c = makeContainer();
  makeChrome(c, 'svp-controls', 6);
  const v = makeVideo(c);
  showCue(c, enableCaptions(v), 'z', 1);
  eq(boxIn(c)[0].style.zIndex, '5', 'one below the chrome layer via the measured path');
});

test('a container with no <video> at all still falls back to the last-resort constant 20', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  const box = boxIn(c)[0];
  v.remove(); // no <video> remains inside container
  CCC.refresh(); // re-runs sitBelowChrome() via every overlay's refresh()
  eq(box.style.zIndex, '20', 'CHROME_FALLBACK_Z used as the true last resort');
});

// -------------------------------------------------------------------- report
console.log('\nVideo Streaming Caption Customizer — simulation suite\n');
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
console.log('instrumentation:', JSON.stringify(counters));
process.exit(fail ? 1 : 0);

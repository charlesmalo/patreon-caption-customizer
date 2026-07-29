/**
 * Simulation / stress test suite for patreon-captions-top.user.js
 * ---------------------------------------------------------------
 * Runs the real userscript against a lightweight fake DOM with a deterministic
 * virtual clock and instrumented timers / rAF / MutationObserver, so we can
 * assert there are no timer leaks, no runaway mutation scans, no infinite
 * track-mode loops, no overlay stacking, and no crashes/stack overflows.
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
  _adopt(node) {
    if (node.nodeType === 11) { const kids = node.childNodes.slice(); node.childNodes.length = 0; kids.forEach((k) => this._adopt(k)); return; }
    if (node.parentNode) node.parentNode._remove(node);
    node.parentNode = this; this.childNodes.push(node);
    if (isConnected(this)) record([node]);
  }
  _remove(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; }
  appendChild(node) { this._adopt(node); return node; }
  append(...args) { for (const a of args) this._adopt(typeof a === 'string' ? new FakeText(a) : a); }
  replaceChildren(...args) { this.childNodes.slice().forEach((k) => this._remove(k)); if (args.length) this.append(...args); }
  remove() { if (this.parentNode) this.parentNode._remove(this); }
  querySelectorAll(sel) { counters.qsaElement++; return qsa(this, sel); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (matchSel(n, sel)) return n; n = n.parentNode; } return null; }
  addEventListener(t, fn) { (this._ev[t] || (this._ev[t] = [])).push(fn); }
  removeEventListener(t, fn) { const a = this._ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
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
  createDocumentFragment: () => new FakeFragment(),
  querySelectorAll: (sel) => { counters.qsaDocument++; return qsa(ROOT, sel); },
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
Object.assign(global, {
  document: documentMock,
  localStorage: localStorageMock,
  getComputedStyle: getComputedStyleMock,
  requestAnimationFrame: rafMock,
  cancelAnimationFrame: cafMock,
  setTimeout: setTimeoutMock,
  clearTimeout: clearTimeoutMock,
  MutationObserver: MutationObserverMock,
});

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'caption-customizer.js'), 'utf8');
// eslint-disable-next-line no-eval
(0, eval)(SRC); // run the userscript IIFE against our mocked globals

// ----------------------------------------------------------- test builders
const LS_KEY = 'patreon-caption-style-v2';
const readLS = () => JSON.parse(localStorageMock.getItem(LS_KEY) || '{}');

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

test('script loaded and scanned the document exactly once at init', () => {
  eq(counters.qsaDocument, 1, 'init document scan count');
});

test('attaching a video creates exactly one overlay', () => {
  const c = makeContainer();
  makeVideo(c);
  eq(boxIn(c).length, 1, 'overlay count');
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

test('corner-resize changes the font size and persists', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  enableCaptions(v);
  const box = boxIn(c)[0];
  fire(findByClass(box, 'pcr-reset'), 'click'); // fontPx=22
  const handle = findByClass(box, 'pcr-handle');
  fire(handle, 'pointerdown', { clientX: 0, clientY: 0 });
  fire(handle, 'pointermove', { clientX: 100, clientY: 100 }); // d=100 → +20px
  fire(handle, 'pointerup', {});
  eq(readLS().fontPx, 42, 'fontPx persisted');
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

test('reset restores every default', () => {
  const c = makeContainer();
  const v = makeVideo(c);
  enableCaptions(v);
  const box = boxIn(c)[0];
  fire(findByClass(box, 'pcr-reset'), 'click');
  const ls = readLS();
  eq(ls.xPct, 50); eq(ls.yPct, 88); eq(ls.fontPx, 22);
  eq(ls.textColor, '#FFFFFF'); eq(ls.textAlpha, 1);
  eq(ls.bgColor, '#000000'); eq(ls.bgAlpha, 0.55);
  eq(ls.autoscroll, true);
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

// -------------------------------------------------------------------- report
console.log('\nPatreon Caption Customizer — simulation suite\n');
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
console.log('instrumentation:', JSON.stringify(counters));
process.exit(fail ? 1 : 0);

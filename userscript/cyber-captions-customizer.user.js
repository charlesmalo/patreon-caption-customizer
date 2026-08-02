// ==UserScript==
// @name         Video Streaming Caption Customizer — Move, Resize & Recolor Captions & Subtitles
// @namespace    https://github.com/charlesmalo
// @author       Charles M.
// @icon         https://raw.githubusercontent.com/charlesmalo/cyber-captions-customizer/main/CyberCaptionsCustomizer.png
// @version      3.0.0
// @description  Move, resize & recolor captions/subtitles on video streaming sites, including YouTube. Drag anywhere, resize the box, set font size, text color, and background opacity, with optional auto-scroll. Set persistent default looks (global or per-site) in the settings dashboard; live edits act as a per-site session override. Works on YouTube plus players using native HTML5 WebVTT captions: Patreon, Vimeo, Streamable, and hls.js / Shaka / Video.js / Plyr / JW Player based sites.
// @match        *://*.patreon.com/*
// @match        *://*.youtube.com/*
// @match        *://*.youtube-nocookie.com/*
// @match        *://*.vimeo.com/*
// @match        *://*.streamable.com/*
// @match        *://*.dailymotion.com/*
// @match        *://*.ted.com/*
// @match        *://*.twitch.tv/*
// @match        *://*.kick.com/*
// @match        *://*.wistia.com/*
// @match        *://*.wistia.net/*
// @match        *://*.brightcove.net/*
// @match        *://*.floatplane.com/*
// @match        *://*.nebula.tv/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==
/**
 * Video Streaming Caption Customizer
 * ==================================
 *
 * WHAT IT DOES
 *   Replaces a streaming site's fixed, bottom-anchored captions with a caption
 *   box you can freely reposition, resize (as a text container), and recolor —
 *   similar to YouTube's draggable captions, plus optional auto-scroll for long
 *   captions. Works on players that expose native HTML5 WebVTT captions AND on
 *   YouTube (which draws its own caption DOM — we mirror it into our overlay).
 *
 * TWO-TIER SETTINGS
 *   • DEFAULTS  — a persistent baseline you set ahead of time in the settings
 *     dashboard (gear button on the toolbar). Defaults can be Global (all sites)
 *     or per-platform, and cover position, size, font, colors, opacity, and
 *     auto-scroll.
 *   • SESSION OVERRIDE — the live customizer (drag / resize / recolor on the
 *     video) writes a per-platform override that layers on top of the defaults
 *     and persists across reloads until you hit Reset (or clear browser data).
 *
 *   Effective look = built-in  <  global default  <  platform default  <  override.
 *
 * SITE COVERAGE
 *   Runs on a curated list of streaming sites (toggle each in the dashboard).
 *   You may also add your own sites as-is (see the dashboard's disclaimer).
 *
 * PRIVACY / SAFETY
 *   No network requests, no tracking, no personal data. All state lives in your
 *   own browser (extension storage, userscript storage, or localStorage).
 *
 * This file is the single source of truth. `build.js` wraps it into the
 * userscript and both extension content scripts. It is also loaded by the
 * extension options page (in "panel mode") to render the same dashboard.
 *
 * @license MIT
 */
(function () {
  'use strict';

  const W = typeof window !== 'undefined' ? window : {};
  const PANEL_MODE = !!W.__CCC_PANEL_MODE__; // options page hosts the dashboard only

  // ---- Curated streaming sites (base domain + label) -----------------------
  const SITES = [
    ['patreon.com', 'Patreon'], ['youtube.com', 'YouTube'], ['vimeo.com', 'Vimeo'],
    ['streamable.com', 'Streamable'], ['dailymotion.com', 'Dailymotion'], ['ted.com', 'TED'],
    ['twitch.tv', 'Twitch'], ['kick.com', 'Kick'], ['wistia.com', 'Wistia'], ['wistia.net', 'Wistia'],
    ['brightcove.net', 'Brightcove'], ['floatplane.com', 'Floatplane'], ['nebula.tv', 'Nebula'],
  ];
  const hostname = () => String((typeof location !== 'undefined' && location.hostname) || '').toLowerCase();
  const siteKey = (host) => {
    const h = String(host || '').replace(/^www\./, '');
    for (const [base] of SITES) if (h === base || h.endsWith('.' + base)) return base;
    if (/(^|\.)youtube-nocookie\.com$/.test(h)) return 'youtube.com';
    const p = h.split('.');
    return p.length >= 2 ? p.slice(-2).join('.') : h;
  };
  const isYouTube = () => /(^|\.)youtube(-nocookie)?\.com$/.test(hostname());

  // ---- Built-in defaults ----------------------------------------------------
  const BUILTIN = {
    xPct: 50, yPct: 88,          // box CENTRE position, % of the player
    widthPct: 55,                // box width, % of player width (text wraps within)
    heightPct: 16,               // reading-window height, % of player height
    fontPx: 22,                  // font size (px)
    textColor: '#FFFFFF',        // characters — always full opacity
    bgColor: '#000000', bgAlpha: 0.55, // background box color + opacity
    autoscroll: true,            // scroll long captions within the box height
  };
  const STYLE_KEYS = Object.keys(BUILTIN);
  const LEGACY_KEY = 'patreon-caption-style-v2'; // pre-v3 single-key format
  const SETTINGS_KEY = 'ccc-settings-v3';

  // ---- Storage abstraction (extension storage / userscript GM / localStorage)
  // load(cb) calls back with the raw stored value. It is SYNCHRONOUS for the
  // localStorage and GM backends and ASYNCHRONOUS for chrome.storage; callers
  // must not assume sync completion.
  const store = (function createStore() {
    const chromeStore = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) ? chrome.storage.sync : null;
    const gmGet = (typeof GM_getValue !== 'undefined') ? GM_getValue : null;
    const gmSet = (typeof GM_setValue !== 'undefined') ? GM_setValue : null;
    const ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; } };
    return {
      load(cb) {
        if (chromeStore) { chromeStore.get(SETTINGS_KEY, (o) => cb(o && o[SETTINGS_KEY])); return; }
        if (gmGet) { cb(gmGet(SETTINGS_KEY)); return; }
        const s = ls(); cb(s ? s.getItem(SETTINGS_KEY) : null);
      },
      save(settings) {
        if (chromeStore) { try { chromeStore.set({ [SETTINGS_KEY]: settings }); } catch (_) {} return; }
        const str = JSON.stringify(settings);
        if (gmSet) { try { gmSet(SETTINGS_KEY, str); } catch (_) {} return; }
        const s = ls(); if (s) { try { s.setItem(SETTINGS_KEY, str); } catch (_) {} }
      },
      onChange(cb) {
        if (chromeStore && chrome.storage.onChanged) {
          chrome.storage.onChanged.addListener((ch, area) => {
            if (area === 'sync' && ch[SETTINGS_KEY]) cb(ch[SETTINGS_KEY].newValue);
          });
        }
      },
      legacy() { const s = ls(); try { return s ? JSON.parse(s.getItem(LEGACY_KEY) || 'null') : null; } catch (_) { return null; } },
    };
  })();

  // ---- Settings model + tiered resolution ----------------------------------
  let settings = normalize(null);
  function normalize(raw) {
    let s = raw;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch (_) { s = null; } }
    if (!s || typeof s !== 'object') s = {};
    return {
      v: 3,
      coverage: (s.coverage && typeof s.coverage === 'object') ? s.coverage : {},
      customSites: Array.isArray(s.customSites) ? s.customSites.slice() : [],
      defaults: {
        global: (s.defaults && s.defaults.global) || {},
        platforms: (s.defaults && s.defaults.platforms) || {},
      },
      overrides: (s.overrides && typeof s.overrides === 'object') ? s.overrides : {},
    };
  }
  const pickStyle = (o) => { const out = {}; for (const k of STYLE_KEYS) if (o && k in o) out[k] = o[k]; return out; };
  // base = built-in  <  global default  <  platform default (no override)
  const baseStyle = (host) => Object.assign({}, BUILTIN, pickStyle(settings.defaults.global), pickStyle(settings.defaults.platforms[host]));
  // resolved = base  <  session override
  const resolveStyle = (host) => Object.assign(baseStyle(host), pickStyle(settings.overrides[host]));
  const isCovered = (host) => settings.coverage[host] !== false;
  const saveOverride = (host, style) => { settings.overrides[host] = pickStyle(style); store.save(settings); };
  const clearOverride = (host) => { delete settings.overrides[host]; store.save(settings); };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rgba = (hex, a) => {
    const n = parseInt((/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000').slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
  };
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const one = (root, sel) => { const l = root.querySelectorAll(sel); return l && l.length ? l[0] : null; };
  const all = (root, sel) => { const l = root.querySelectorAll(sel); return l ? [].slice.call(l) : []; };

  // Find the player area to anchor the overlay to: nearest ancestor whose class
  // looks like a video player (covers Patreon's VideoPlayerRoot and most sites),
  // else the video's direct parent.
  const findContainer = (v) => {
    let n = v.parentElement, generic = null;
    while (n && n !== document.body && n.nodeType === 1) {
      const c = String(n.className || '');
      if (/VideoPlayerRoot/.test(c)) return n;
      if (!generic && /player/i.test(c)) generic = n;
      n = n.parentElement;
    }
    return generic || v.parentElement;
  };
  // YouTube: anchor to the player root that holds its caption DOM.
  const youtubeContainer = (v) => {
    let n = v.parentElement;
    while (n && n !== document.body && n.nodeType === 1) {
      const c = String(n.className || ''), id = String(n.id || '');
      if (/html5-video-player/.test(c) || id === 'movie_player') return n;
      n = n.parentElement;
    }
    return findContainer(v);
  };

  // ---- Styles --------------------------------------------------------------
  const CSS = `
  .pcr-box{position:absolute;z-index:2147483000;transform:translate(-50%,-50%);
    box-sizing:border-box;padding:.15em .5em;border-radius:4px;font-family:inherit;
    line-height:1.3;text-align:center;text-shadow:0 0 3px #000,0 0 3px #000;
    cursor:move;user-select:none;pointer-events:auto;display:none;white-space:pre-wrap;}
  .pcr-box.pcr-on{display:block;}
  .pcr-text{pointer-events:none;}
  .pcr-box.pcr-scroll-on .pcr-text{overflow:hidden;}
  .pcr-scroll{will-change:transform;}
  .pcr-handle{position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;
    border:2px solid rgba(255,255,255,.85);border-radius:3px;background:rgba(0,0,0,.55);
    cursor:nwse-resize;pointer-events:auto;display:none;}
  .pcr-box.pcr-open .pcr-handle{display:block;}
  .pcr-bar{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);
    display:none;flex-direction:column;gap:5px;margin-bottom:2px;padding:6px 8px;
    border-radius:6px;background:rgba(18,18,18,.96);box-shadow:0 2px 10px rgba(0,0,0,.6);
    white-space:nowrap;font-family:sans-serif;cursor:default;text-shadow:none;}
  .pcr-box.pcr-open .pcr-bar{display:flex;}
  .pcr-box.pcr-flip .pcr-bar{top:100%;bottom:auto;margin-top:2px;margin-bottom:0;}
  .pcr-row{display:flex;align-items:center;gap:6px;}
  .pcr-row label{font:11px sans-serif;color:#ddd;width:38px;flex:0 0 auto;}
  .pcr-pick{width:26px;height:20px;padding:0;border:1px solid #555;border-radius:3px;background:#0d0d0d;cursor:pointer;flex:0 0 auto;}
  .pcr-slider{width:96px;}
  .pcr-out{font:11px monospace;color:#bbb;width:40px;text-align:right;flex:0 0 auto;}
  .pcr-check{display:flex;align-items:center;gap:6px;cursor:pointer;font:11px sans-serif;color:#ddd;}
  .pcr-check input{cursor:pointer;}
  .pcr-actions{display:flex;gap:6px;align-self:flex-end;}
  .pcr-btn{font:12px sans-serif;padding:2px 8px;cursor:pointer;border-radius:3px;border:1px solid #555;background:#242424;color:#fff;}
  .pcr-btn:hover{background:#333;}
  .pcr-gear{font:13px sans-serif;line-height:1;padding:2px 7px;}
  /* Hide YouTube's own caption rendering while we mirror it. */
  .pcr-yt-hide .ytp-caption-window-container{opacity:0 !important;height:0 !important;overflow:hidden !important;pointer-events:none !important;}
  /* Settings dashboard */
  .ccc-modal{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:flex-start;
    justify-content:center;background:rgba(0,0,0,.55);font-family:sans-serif;overflow:auto;}
  .ccc-panel{margin:5vh 0;width:min(560px,94vw);background:#161616;color:#eee;border-radius:10px;
    box-shadow:0 8px 40px rgba(0,0,0,.6);padding:0 0 16px;}
  .ccc-body.ccc-embedded{margin:0;}
  .ccc-embedded .ccc-panel{margin:16px auto;}
  .ccc-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #2a2a2a;}
  .ccc-head h1{font-size:16px;margin:0;font-weight:600;}
  .ccc-x{background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;line-height:1;}
  .ccc-x:hover{color:#fff;}
  .ccc-sec{padding:14px 16px;border-bottom:1px solid #232323;}
  .ccc-sec h2{font-size:13px;margin:0 0 8px;color:#9ecbff;font-weight:600;text-transform:uppercase;letter-spacing:.03em;}
  .ccc-sites{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;}
  .ccc-site{display:flex;align-items:center;gap:7px;font-size:13px;}
  .ccc-note{font-size:12px;color:#9a9a9a;line-height:1.45;margin:8px 0 0;}
  .ccc-note b{color:#e0c15a;}
  .ccc-grid{display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;font-size:13px;}
  .ccc-grid label{color:#ccc;}
  .ccc-grid input[type=number]{width:64px;background:#0e0e0e;border:1px solid #444;color:#eee;border-radius:4px;padding:3px 5px;}
  .ccc-grid input[type=color]{width:34px;height:24px;padding:0;border:1px solid #555;border-radius:4px;background:#0d0d0d;}
  .ccc-scope{display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:13px;}
  .ccc-scope select,.ccc-add input{background:#0e0e0e;border:1px solid #444;color:#eee;border-radius:4px;padding:4px 6px;font-size:13px;}
  .ccc-add{display:flex;gap:8px;margin-top:8px;}
  .ccc-add input{flex:1;}
  .ccc-list{list-style:none;margin:8px 0 0;padding:0;}
  .ccc-list li{display:flex;align-items:center;justify-content:space-between;font-size:13px;padding:3px 0;}
  .ccc-row-actions{display:flex;gap:8px;margin-top:10px;}
  .ccc-btn{font:13px sans-serif;padding:5px 10px;cursor:pointer;border-radius:5px;border:1px solid #555;background:#262626;color:#fff;}
  .ccc-btn:hover{background:#333;}
  .ccc-btn.primary{background:#2b5fb0;border-color:#2b5fb0;}
  .ccc-btn.primary:hover{background:#356ecb;}
  .ccc-status{font-size:12px;color:#9a9a9a;margin-top:6px;}`;
  let cssInjected = false;
  const injectCSS = () => {
    if (cssInjected) return; cssInjected = true;
    (document.head || document.documentElement).appendChild(
      Object.assign(document.createElement('style'), { textContent: CSS }));
  };

  // ---- Live overlay registry (for cross-context / dashboard refresh) --------
  const overlays = new Set();
  const refreshAll = () => overlays.forEach((o) => o.refresh());

  // ---- Per-video controller ------------------------------------------------
  const seen = new WeakSet();

  function attach(video) {
    if (seen.has(video)) return;
    seen.add(video);

    const host = siteKey(hostname());
    const yt = isYouTube();
    const container = yt ? youtubeContainer(video) : findContainer(video);
    if (!container) return;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    all(container, ':scope > .pcr-box').forEach((n) => n.remove()); // never stack

    const style = resolveStyle(host);

    // --- Build the overlay DOM ---
    const box = el('div', 'pcr-box');
    const text = el('div', 'pcr-text');
    const scroll = el('div', 'pcr-scroll');
    text.appendChild(scroll);
    const handle = el('div', 'pcr-handle');
    const bar = el('div', 'pcr-bar');

    const fontRow = el('div', 'pcr-row');
    const fontLbl = el('label'); fontLbl.textContent = 'Font';
    const fontRange = el('input', 'pcr-slider'); fontRange.type = 'range'; fontRange.min = '10'; fontRange.max = '72'; fontRange.step = '1';
    const fontOut = el('span', 'pcr-out');
    fontRow.append(fontLbl, fontRange, fontOut);

    const textRow = el('div', 'pcr-row');
    const textLbl = el('label'); textLbl.textContent = 'Text';
    const textPick = el('input', 'pcr-pick'); textPick.type = 'color';
    textRow.append(textLbl, textPick);

    const boxRow = el('div', 'pcr-row');
    const boxLbl = el('label'); boxLbl.textContent = 'Box';
    const bgPick = el('input', 'pcr-pick'); bgPick.type = 'color';
    const bgAlpha = el('input', 'pcr-slider'); bgAlpha.type = 'range'; bgAlpha.min = '0'; bgAlpha.max = '100'; bgAlpha.step = '1';
    const bgOut = el('span', 'pcr-out');
    boxRow.append(boxLbl, bgPick, bgAlpha, bgOut);

    const autoRow = el('label', 'pcr-check');
    const auto = el('input'); auto.type = 'checkbox';
    const autoLbl = el('span'); autoLbl.textContent = 'Auto-scroll long captions';
    autoRow.append(auto, autoLbl);

    const actions = el('div', 'pcr-actions');
    const gear = el('button', 'pcr-btn pcr-gear'); gear.type = 'button'; gear.textContent = '⚙'; gear.title = 'Caption settings';
    const reset = el('button', 'pcr-btn pcr-reset'); reset.type = 'button'; reset.textContent = 'Reset';
    actions.append(gear, reset);

    bar.append(fontRow, textRow, boxRow, autoRow, actions);
    box.append(bar, text, handle);
    container.appendChild(box);

    // --- Visibility state ---
    let ccOn = false, hasText = false, open = false, dragging = false, hoverTimer = null;

    const place = () => {
      box.style.left = style.xPct + '%';
      box.style.top = style.yPct + '%';
      box.classList.toggle('pcr-flip', style.yPct < 50);
    };
    const size = () => {
      box.style.width = style.widthPct + '%';
      if (style.autoscroll) {
        text.style.height = (style.heightPct / 100 * container.getBoundingClientRect().height) + 'px';
      } else {
        text.style.height = '';
      }
    };
    const apply = () => {
      place();
      box.classList.toggle('pcr-scroll-on', style.autoscroll);
      size();
      box.style.fontSize = style.fontPx + 'px';
      box.style.color = rgba(style.textColor, 1);
      box.style.background = rgba(style.bgColor, style.bgAlpha);
      fontRange.value = style.fontPx; fontOut.textContent = style.fontPx + 'px';
      textPick.value = style.textColor;
      bgPick.value = style.bgColor;
      bgAlpha.value = Math.round(style.bgAlpha * 100); bgOut.textContent = Math.round(style.bgAlpha * 100) + '%';
      auto.checked = style.autoscroll;
    };
    const visible = () => box.classList.toggle('pcr-on', isCovered(host) && ccOn && (hasText || open || dragging));
    apply(); visible();

    // ---- Auto-scroll -------------------------------------------------------
    let scrollTimer = null, scrollRaf = null;
    const stopScroll = () => {
      if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null; }
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
      scroll.style.transition = 'none';
      scroll.style.transform = 'translateY(0)';
    };
    const startScroll = () => {
      stopScroll();
      if (!style.autoscroll) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        const lh = style.fontPx * 1.3;
        const viewportH = parseFloat(text.style.height) || (style.heightPct / 100 * container.getBoundingClientRect().height);
        const visibleLines = Math.max(1, Math.floor(viewportH / lh));
        const totalLines = Math.max(1, Math.round(scroll.scrollHeight / lh));
        if (totalLines <= visibleLines) return;
        const stepDelay = Math.max(600, (visibleLines / totalLines) * 3000);
        const maxStep = totalLines - visibleLines;
        let step = 0;
        const advance = () => {
          step++;
          scroll.style.transition = 'transform .3s ease';
          scroll.style.transform = `translateY(${-step * lh}px)`;
          scrollTimer = step < maxStep ? setTimeout(advance, stepDelay) : null;
        };
        scrollTimer = setTimeout(advance, stepDelay);
      });
    };

    // ---- Shared renderer: draw an array of text lines ----------------------
    const showLines = (lines) => {
      if (!lines || !lines.length) { hasText = false; scroll.replaceChildren(); stopScroll(); visible(); return; }
      const frag = document.createDocumentFragment();
      for (let i = 0; i < lines.length; i++) {
        if (i) frag.appendChild(document.createElement('br'));
        frag.appendChild(document.createTextNode(lines[i]));
      }
      scroll.replaceChildren(frag);
      hasText = true; size(); visible(); startScroll();
    };

    // ---- Caption source: native WebVTT text tracks -------------------------
    const wiredTracks = new WeakSet();
    const cueLines = (track) => {
      const cues = track.activeCues, out = [];
      if (!cues) return out;
      for (let i = 0; i < cues.length; i++) {
        const t = String(cues[i].text || '');
        t.split(/\r?\n/).forEach((ln) => out.push(ln));
      }
      return out;
    };
    const wireNative = () => {
      const wire = (track) => {
        if (wiredTracks.has(track)) return;
        wiredTracks.add(track);
        track.addEventListener('cuechange', () => { if (ccOn) showLines(cueLines(track)); });
      };
      const sync = () => {
        let on = false, active = null;
        for (const t of video.textTracks) {
          if (t.kind !== 'captions' && t.kind !== 'subtitles') continue;
          if (t.mode === 'showing') t.mode = 'hidden';
          if (t.mode === 'hidden') { on = true; wire(t); active = t; }
        }
        ccOn = on;
        if (ccOn && active) showLines(cueLines(active));
        else { hasText = false; scroll.replaceChildren(); stopScroll(); }
        visible();
      };
      video.textTracks.addEventListener('addtrack', sync);
      video.textTracks.addEventListener('removetrack', sync);
      video.textTracks.addEventListener('change', sync);
      sync();
    };

    // ---- Caption source: YouTube's own caption DOM (mirror) ----------------
    const ytSegText = (line) => {
      const segs = all(line, '.ytp-caption-segment');
      return segs.length ? segs.map((s) => s.textContent || '').join('') : (line.textContent || '');
    };
    const ytLines = () => {
      const cont = one(container, '.ytp-caption-window-container') || one(container, '.caption-window');
      if (!cont) return [];
      const vis = all(cont, '.caption-visual-line');
      const src = vis.length ? vis.map(ytSegText) : all(cont, '.ytp-caption-segment').map((s) => s.textContent || '');
      return src.filter((s) => s !== '');
    };
    const wireYouTube = () => {
      // The observer watches the whole player, which also contains OUR overlay,
      // so we must ignore self-triggered mutations: only re-render when the
      // caption text actually changes (otherwise our own DOM writes would loop).
      let lastKey = null;
      const readAndRender = () => {
        const lines = ytLines();
        container.classList.toggle('pcr-yt-hide', isCovered(host)); // hide native only while covered
        const key = lines.join('');
        if (key === lastKey) return;
        lastKey = key;
        ccOn = lines.length > 0;
        if (ccOn) showLines(lines);
        else { hasText = false; scroll.replaceChildren(); stopScroll(); visible(); }
      };
      new MutationObserver(readAndRender).observe(container, { childList: true, subtree: true, characterData: true });
      readAndRender();
    };

    // ---- Hover open/close with a 1s close delay ----------------------------
    box.addEventListener('pointerenter', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      open = true; box.classList.add('pcr-open'); visible();
    });
    box.addEventListener('pointerleave', () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => { hoverTimer = null; open = false; box.classList.remove('pcr-open'); visible(); }, 1000);
    });

    // ---- Drag to reposition ------------------------------------------------
    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pcr-handle') || e.target.closest('.pcr-bar')) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = style.xPct / 100 * rect.width, cy = style.yPct / 100 * rect.height;
      const gx = e.clientX - rect.left - cx, gy = e.clientY - rect.top - cy;
      dragging = true; box.setPointerCapture(e.pointerId);
      const move = (ev) => {
        style.xPct = clamp((ev.clientX - rect.left - gx) / rect.width * 100, 2, 98);
        style.yPct = clamp((ev.clientY - rect.top - gy) / rect.height * 100, 4, 96);
        place();
      };
      const up = () => {
        box.removeEventListener('pointermove', move);
        box.removeEventListener('pointerup', up);
        dragging = false; saveOverride(host, style); visible();
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
    });

    // ---- Corner drag to resize the container -------------------------------
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const rect = container.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, sw = style.widthPct, sh = style.heightPct;
      dragging = true; handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        style.widthPct = clamp(sw + 2 * (ev.clientX - sx) / rect.width * 100, 15, 95);
        style.heightPct = clamp(sh + 2 * (ev.clientY - sy) / rect.height * 100, 6, 90);
        size();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        dragging = false; saveOverride(host, style); startScroll(); visible();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });

    // ---- Toolbar controls --------------------------------------------------
    fontRange.addEventListener('input', () => {
      style.fontPx = clamp(parseInt(fontRange.value, 10) || BUILTIN.fontPx, 10, 72);
      apply(); saveOverride(host, style); startScroll();
    });
    textPick.addEventListener('input', () => { style.textColor = textPick.value.toUpperCase(); apply(); saveOverride(host, style); });
    bgPick.addEventListener('input', () => { style.bgColor = bgPick.value.toUpperCase(); apply(); saveOverride(host, style); });
    bgAlpha.addEventListener('input', () => { style.bgAlpha = clamp(bgAlpha.value / 100, 0, 1); apply(); saveOverride(host, style); });
    auto.addEventListener('change', () => {
      style.autoscroll = auto.checked; apply(); saveOverride(host, style);
      if (style.autoscroll) startScroll(); else stopScroll();
    });
    gear.addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });
    reset.addEventListener('click', () => {
      clearOverride(host);
      Object.assign(style, baseStyle(host));
      apply(); visible();
      if (style.autoscroll) startScroll(); else stopScroll();
    });

    // ---- Register for dashboard/cross-context refresh -----------------------
    overlays.add({
      refresh() {
        Object.assign(style, resolveStyle(host));
        apply();
        if (isYouTube()) container.classList.toggle('pcr-yt-hide', isCovered(host));
        visible();
        if (style.autoscroll) startScroll(); else stopScroll();
      },
    });

    if (yt) wireYouTube(); else wireNative();
  }

  // ---- Settings dashboard (shared panel) -----------------------------------
  let panelHost = null;
  const canRequestSites = () => (typeof chrome !== 'undefined' && chrome.permissions && chrome.permissions.request);
  function requestSiteAccess(domain) {
    if (!canRequestSites()) return;
    const origins = [`*://${domain}/*`, `*://*.${domain}/*`];
    try {
      chrome.permissions.request({ origins }, (granted) => {
        if (granted && chrome.scripting && chrome.scripting.registerContentScripts) {
          chrome.scripting.registerContentScripts([{
            id: 'ccc-' + domain.replace(/[^a-z0-9.]/gi, '-'),
            matches: origins, js: ['content.js'], runAt: 'document_start', allFrames: true,
          }]).catch(() => {});
        }
      });
    } catch (_) {}
  }
  const normDomain = (v) => {
    let d = String(v || '').trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : '';
  };

  function buildPanel(embedded) {
    injectCSS();
    const host = siteKey(hostname());
    const root = el('div', embedded ? 'ccc-body ccc-embedded' : 'ccc-modal');
    const panel = el('div', 'ccc-panel');
    root.appendChild(panel);
    const close = () => { if (!embedded && root.parentNode) root.remove(); panelHost = null; };
    if (!embedded) root.addEventListener('click', (e) => { if (e.target === root) close(); });

    const head = el('div', 'ccc-head');
    const h1 = el('h1'); h1.textContent = 'Caption Customizer — Settings';
    head.appendChild(h1);
    if (!embedded) { const x = el('button', 'ccc-x'); x.type = 'button'; x.textContent = '×'; x.addEventListener('click', close); head.appendChild(x); }
    panel.appendChild(head);

    // --- Coverage ---
    const cov = el('div', 'ccc-sec');
    cov.appendChild(Object.assign(el('h2'), { textContent: 'Sites covered' }));
    const grid = el('div', 'ccc-sites');
    SITES.filter((s, i, a) => a.findIndex((x) => x[0] === s[0]) === i).forEach(([base, label]) => {
      const row = el('label', 'ccc-site');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = settings.coverage[base] !== false;
      cb.addEventListener('change', () => { settings.coverage[base] = cb.checked; store.save(settings); refreshAll(); });
      row.append(cb, Object.assign(el('span'), { textContent: label + '  (' + base + ')' }));
      grid.appendChild(row);
    });
    cov.appendChild(grid);
    panel.appendChild(cov);

    // --- Custom sites ---
    const custom = el('div', 'ccc-sec');
    custom.appendChild(Object.assign(el('h2'), { textContent: 'Your own sites (as-is)' }));
    const list = el('ul', 'ccc-list');
    const renderList = () => {
      list.replaceChildren();
      settings.customSites.forEach((d) => {
        const li = el('li');
        li.appendChild(Object.assign(el('span'), { textContent: d }));
        const rm = el('button', 'ccc-btn'); rm.type = 'button'; rm.textContent = 'Remove';
        rm.addEventListener('click', () => { settings.customSites = settings.customSites.filter((x) => x !== d); store.save(settings); renderList(); });
        li.appendChild(rm);
        list.appendChild(li);
      });
    };
    renderList();
    const add = el('div', 'ccc-add');
    const inp = el('input'); inp.type = 'text'; inp.placeholder = 'example.com';
    const addBtn = el('button', 'ccc-btn primary'); addBtn.type = 'button'; addBtn.textContent = 'Add site';
    const addStatus = el('div', 'ccc-status');
    addBtn.addEventListener('click', () => {
      const d = normDomain(inp.value);
      if (!d) { addStatus.textContent = 'Enter a valid domain, e.g. example.com'; return; }
      if (!settings.customSites.includes(d)) settings.customSites.push(d);
      settings.coverage[d] = true; store.save(settings); inp.value = ''; renderList();
      if (canRequestSites()) { requestSiteAccess(d); addStatus.textContent = 'Requesting access to ' + d + '…'; }
      else addStatus.textContent = 'Added ' + d + '. In the extension, open its Options page to grant access; as a userscript, add a matching rule in Tampermonkey.';
    });
    add.append(inp, addBtn);
    custom.append(add, addStatus, list);
    const disc = el('p', 'ccc-note');
    const b1 = el('b'); b1.textContent = 'Heads up:';
    const b2 = el('b'); b2.textContent = '5★ review';
    disc.append(
      b1,
      document.createTextNode(' custom sites are not officially supported — they run as-is with no guarantees. If one works well, please leave a '),
      b2,
      document.createTextNode(' on the extension store naming the site so we can consider adding official support (no promises).'),
    );
    custom.appendChild(disc);
    panel.appendChild(custom);

    // --- Defaults ---
    const def = el('div', 'ccc-sec');
    def.appendChild(Object.assign(el('h2'), { textContent: 'Default look' }));
    const scopeRow = el('div', 'ccc-scope');
    scopeRow.appendChild(Object.assign(el('label'), { textContent: 'Applies to' }));
    const scope = el('select');
    scope.appendChild(Object.assign(el('option'), { value: 'global', textContent: 'All sites (global)' }));
    SITES.filter((s, i, a) => a.findIndex((x) => x[0] === s[0]) === i).forEach(([base, label]) => {
      const label2 = base === host ? label + ' — this site' : label;
      scope.appendChild(Object.assign(el('option'), { value: base, textContent: label2 + ' (' + base + ')' }));
    });
    scope.value = (host && SITES.some((s) => s[0] === host)) ? host : 'global';
    scopeRow.appendChild(scope);
    def.appendChild(scopeRow);

    const dg = el('div', 'ccc-grid');
    const scopeObj = () => scope.value === 'global'
      ? (settings.defaults.global || (settings.defaults.global = {}))
      : (settings.defaults.platforms[scope.value] || (settings.defaults.platforms[scope.value] = {}));
    const effective = () => scope.value === 'global'
      ? Object.assign({}, BUILTIN, pickStyle(settings.defaults.global))
      : baseStyle(scope.value);
    const controls = [];
    const addField = (label, ctl, accessor) => {
      dg.appendChild(Object.assign(el('label'), { textContent: label }));
      dg.appendChild(ctl);
      controls.push(accessor);
    };
    const numField = (label, key, min, max) => {
      const n = el('input'); n.type = 'number'; n.min = String(min); n.max = String(max);
      n.addEventListener('change', () => { scopeObj()[key] = clamp(parseFloat(n.value) || BUILTIN[key], min, max); store.save(settings); refreshAll(); });
      addField(label, n, { key, set: (v) => { n.value = v; } });
    };
    const colorField = (label, key) => {
      const c = el('input'); c.type = 'color';
      c.addEventListener('input', () => { scopeObj()[key] = c.value.toUpperCase(); store.save(settings); refreshAll(); });
      addField(label, c, { key, set: (v) => { c.value = v; } });
    };
    numField('Font (px)', 'fontPx', 10, 72);
    numField('X position (%)', 'xPct', 0, 100);
    numField('Y position (%)', 'yPct', 0, 100);
    numField('Width (%)', 'widthPct', 10, 100);
    numField('Height (%)', 'heightPct', 5, 100);
    colorField('Text color', 'textColor');
    colorField('Box color', 'bgColor');
    (function alphaField() {
      const r = el('input'); r.type = 'range'; r.min = '0'; r.max = '100';
      r.addEventListener('input', () => { scopeObj().bgAlpha = clamp(r.value / 100, 0, 1); store.save(settings); refreshAll(); });
      addField('Box opacity (%)', r, { key: 'bgAlpha', set: (v) => { r.value = Math.round(v * 100); } });
    })();
    (function autoField() {
      const c = el('input'); c.type = 'checkbox';
      c.addEventListener('change', () => { scopeObj().autoscroll = c.checked; store.save(settings); refreshAll(); });
      addField('Auto-scroll', c, { key: 'autoscroll', set: (v) => { c.checked = !!v; } });
    })();
    const syncControls = () => { const e = effective(); controls.forEach((c) => c.set(e[c.key])); };
    scope.addEventListener('change', syncControls);
    syncControls();
    def.appendChild(dg);

    const rowActions = el('div', 'ccc-row-actions');
    const useLive = el('button', 'ccc-btn'); useLive.type = 'button'; useLive.textContent = 'Save current live look as this default';
    useLive.addEventListener('click', () => { Object.assign(scopeObj(), pickStyle(resolveStyle(host))); store.save(settings); syncControls(); refreshAll(); });
    const clearDef = el('button', 'ccc-btn'); clearDef.type = 'button'; clearDef.textContent = 'Clear this default';
    clearDef.addEventListener('click', () => {
      if (scope.value === 'global') settings.defaults.global = {}; else delete settings.defaults.platforms[scope.value];
      store.save(settings); syncControls(); refreshAll();
    });
    rowActions.append(useLive, clearDef);
    def.appendChild(rowActions);
    panel.appendChild(def);

    // --- Session override ---
    const sess = el('div', 'ccc-sec');
    sess.appendChild(Object.assign(el('h2'), { textContent: 'This session' }));
    const status = el('div', 'ccc-status');
    const clearOv = el('button', 'ccc-btn'); clearOv.type = 'button'; clearOv.textContent = 'Clear session override for ' + host;
    const refreshSess = () => { status.textContent = settings.overrides[host] ? 'A live override is active for ' + host + ' (it takes priority over the defaults above).' : 'No live override for ' + host + ' — the defaults above apply.'; };
    clearOv.addEventListener('click', () => { clearOverride(host); refreshAll(); refreshSess(); });
    refreshSess();
    sess.append(status, clearOv);
    panel.appendChild(sess);

    return { root, close };
  }

  function openPanel() {
    if (panelHost) return;
    const p = buildPanel(false);
    panelHost = p;
    (document.body || document.documentElement).appendChild(p.root);
  }
  function mountPanel(target) {
    const p = buildPanel(true);
    (target || document.body || document.documentElement).appendChild(p.root);
    return p.root;
  }

  // ---- Watch for videos (SPA navigation creates/destroys them) -------------
  const onMutations = (records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO') attach(node);
        else if (node.querySelectorAll) node.querySelectorAll('video').forEach(attach);
      }
    }
  };

  function start() {
    injectCSS();
    if (PANEL_MODE) { mountPanel(document.body); return; }
    if (typeof GM_registerMenuCommand !== 'undefined') { try { GM_registerMenuCommand('Caption Customizer settings', openPanel); } catch (_) {} }
    new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
    document.querySelectorAll('video').forEach(attach);
  }

  // ---- Boot: load settings, migrate legacy key, then start -----------------
  store.load((raw) => {
    settings = normalize(raw);
    const legacy = store.legacy();
    if (legacy && !settings.overrides['patreon.com']) {
      if (legacy.color && !legacy.textColor) legacy.textColor = legacy.color;
      settings.overrides['patreon.com'] = pickStyle(legacy);
      store.save(settings);
    }
    store.onChange((val) => { settings = normalize(val); refreshAll(); });
    start();
  });

  // Namespaced control API (used by the options page and for automation).
  W.CaptionCustomizer = {
    get settings() { return settings; },
    resolveStyle, siteKey, openPanel, mountPanel,
    save: () => store.save(settings),
    refresh: refreshAll,
  };
})();

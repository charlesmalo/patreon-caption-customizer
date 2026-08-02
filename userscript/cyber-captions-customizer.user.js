// ==UserScript==
// @name         Video Streaming Caption Customizer — Move, Resize & Recolor Captions & Subtitles
// @namespace    https://github.com/charlesmalo
// @author       Charles M.
// @icon         https://raw.githubusercontent.com/charlesmalo/cyber-captions-customizer/main/CyberCaptionsCustomizer.png
// @version      2.6
// @description  Move, resize & recolor captions/subtitles on video streaming sites. Drag anywhere, resize the box, set font size, text color, and background opacity, with optional auto-scroll. Works on players using native HTML5 WebVTT captions: Patreon, Vimeo, Streamable, and hls.js / Shaka / Video.js / Plyr / JW Player based sites.
// @match        *://*.patreon.com/*
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
// @grant        none
// @license      MIT
// ==/UserScript==
/**
 * Video Streaming Caption Customizer
 * ==================================
 *
 * WHAT IT DOES
 *   Replaces a streaming site's fixed, bottom-anchored captions with a caption
 *   box you can freely reposition, resize (as a text container), and recolor —
 *   similar to YouTube's draggable captions. Works on video players that expose
 *   native HTML5 WebVTT captions (see SUPPORTED SITES). Your settings are saved
 *   and reused across videos and page reloads until changed.
 *
 * HOW TO USE (once installed in Tampermonkey / Greasemonkey or as an extension)
 *   1. Open a video on a supported site and turn captions on with the CC button.
 *   2. MOVE   : click-drag the caption box anywhere over the video.
 *   3. RESIZE : hover the box, then drag the bottom-right corner handle to size
 *               the text CONTAINER — drag right for a wider box, down for a
 *               taller one, or both (free-form, not diagonal-locked). Words wrap
 *               to the next line by width; the height sets the reading window.
 *   4. STYLE  : hover the box to reveal a toolbar with a Font size slider, a
 *               Text color, a Box background color + opacity, an "Auto-scroll"
 *               toggle, and Reset. The toolbar waits ~1s after your mouse leaves
 *               before closing, so you can move onto it without it vanishing.
 *   The box appears while a caption is on screen (and stays while you interact).
 *   The corner handle and toolbar only appear while you hover the box.
 *
 * OPACITY
 *   Opacity applies to the background box only; the caption text always renders
 *   at full opacity regardless of how transparent the box is.
 *
 * LONG CAPTIONS (auto-scroll)
 *   Text wraps within the box width; if it's taller than the box height, it
 *   scrolls up one line at a time, pausing to read each window. The pause is
 *   proportional to how much of the caption the window shows — a window showing
 *   the whole caption reads for about 3 seconds. Toggle it with the toolbar's
 *   "Auto-scroll" checkbox; when off, the box grows to show the caption in full.
 *
 * SUPPORTED SITES
 *   Any site whose player exposes native HTML5 WebVTT caption tracks. Confirmed
 *   on Patreon; also targets Vimeo, Streamable, and players built on hls.js,
 *   Shaka Player, dash.js, Video.js, Plyr, or JW Player. NOT YouTube — it uses
 *   its own caption system and already offers similar customization.
 *
 * HOW IT WORKS
 *   These players deliver captions through the browser's native WebVTT text
 *   tracks. This script sets the active caption track to `mode = "hidden"` — the
 *   browser stops drawing captions but still fires `cuechange` — then renders
 *   each cue into its own absolutely-positioned overlay it fully controls.
 *   Position and size are stored as percentages of the player, so they survive
 *   resizing and fullscreen. A MutationObserver re-attaches the overlay as
 *   single-page apps swap video elements in and out.
 *
 * PRIVACY / SAFETY
 *   No network requests, no tracking, no personal data. All state lives in a
 *   single localStorage key in your own browser.
 *
 * @license MIT
 */
(function () {
  'use strict';

  // ---- Persisted style (global; survives reloads) --------------------------
  const LS_KEY = 'patreon-caption-style-v2';
  const DEFAULTS = {
    xPct: 50, yPct: 88,          // box CENTRE position, % of the player
    widthPct: 55,                // box width, % of player width (text wraps within)
    heightPct: 16,               // reading-window height, % of player height
    fontPx: 22,                  // font size (px), set via the toolbar slider
    textColor: '#FFFFFF',        // characters — always full opacity
    bgColor: '#000000', bgAlpha: 0.55, // background box color + opacity
    autoscroll: true,            // scroll long captions within the box height
  };
  const load = () => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (_) {}
    if (saved.color && !saved.textColor) saved.textColor = saved.color; // legacy migration
    return Object.assign({}, DEFAULTS, saved);
  };
  const style = load();
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(style)); } catch (_) {} };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rgba = (hex, a) => {
    const n = parseInt((/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000').slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
  };
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  // Find the player area to anchor the overlay to: the nearest ancestor whose
  // class looks like a video player (covers most sites, incl. Patreon's
  // VideoPlayerRoot), else the video's direct parent. Generic across streaming
  // sites that render captions with native HTML5 text tracks.
  const findContainer = (v) => {
    let n = v.parentElement, generic = null;
    while (n && n !== document.body && n.nodeType === 1) {
      const c = String(n.className || '');
      if (/VideoPlayerRoot/.test(c)) return n;          // exact prior Patreon anchor
      if (!generic && /player/i.test(c)) generic = n;   // nearest player-ish wrapper elsewhere
      n = n.parentElement;
    }
    return generic || v.parentElement;
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
  /* Corner handle + toolbar only appear while hovering the box. */
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
  .pcr-reset{align-self:flex-end;font:12px sans-serif;padding:2px 8px;cursor:pointer;border-radius:3px;border:1px solid #555;background:#242424;color:#fff;}
  .pcr-reset:hover{background:#333;}`;
  (document.head || document.documentElement).appendChild(
    Object.assign(document.createElement('style'), { textContent: CSS }));

  // ---- Per-video controller ------------------------------------------------
  const seen = new WeakSet();

  function attach(video) {
    if (seen.has(video)) return;
    seen.add(video);

    const container = findContainer(video);
    if (!container) return;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.querySelectorAll(':scope > .pcr-box').forEach((n) => n.remove()); // never stack

    // --- Build the overlay DOM ---
    const box = el('div', 'pcr-box');
    const text = el('div', 'pcr-text');       // fixed reading window (or auto height)
    const scroll = el('div', 'pcr-scroll');   // inner element we translate up
    text.appendChild(scroll);
    const handle = el('div', 'pcr-handle');
    const bar = el('div', 'pcr-bar');

    // Toolbar: Font slider, Text color, Box color+opacity, Auto-scroll, Reset.
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

    const reset = el('button', 'pcr-reset'); reset.type = 'button'; reset.textContent = 'Reset';

    bar.append(fontRow, textRow, boxRow, autoRow, reset);
    box.append(bar, text, handle);
    container.appendChild(box);

    // --- Visibility state ---
    // ccOn: captions enabled | hasText: a cue is on screen | open: hovering the
    // box (with a 1s close delay) | dragging: mid drag/resize.
    let ccOn = false, hasText = false, open = false, dragging = false, hoverTimer = null;

    // Position-only update (used while dragging to reposition).
    const place = () => {
      box.style.left = style.xPct + '%';
      box.style.top = style.yPct + '%';
      box.classList.toggle('pcr-flip', style.yPct < 50); // top half → toolbar below
    };
    // Size the container: width in %, reading-window height in px (auto when off).
    const size = () => {
      box.style.width = style.widthPct + '%';
      if (style.autoscroll) {
        text.style.height = (style.heightPct / 100 * container.getBoundingClientRect().height) + 'px';
      } else {
        text.style.height = ''; // grow to fit
      }
    };
    // Full re-apply of every style + toolbar control value.
    const apply = () => {
      place();
      box.classList.toggle('pcr-scroll-on', style.autoscroll);
      size();
      box.style.fontSize = style.fontPx + 'px';
      box.style.color = rgba(style.textColor, 1);           // text always opaque
      box.style.background = rgba(style.bgColor, style.bgAlpha);
      fontRange.value = style.fontPx; fontOut.textContent = style.fontPx + 'px';
      textPick.value = style.textColor;
      bgPick.value = style.bgColor;
      bgAlpha.value = Math.round(style.bgAlpha * 100); bgOut.textContent = Math.round(style.bgAlpha * 100) + '%';
      auto.checked = style.autoscroll;
    };
    const visible = () => box.classList.toggle('pcr-on', ccOn && (hasText || open || dragging));
    apply(); visible();

    // ---- Auto-scroll -------------------------------------------------------
    // Scroll up one line at a time when the wrapped text is taller than the
    // reading window. Pause per step = (window lines / total lines) x 3s.
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
        if (totalLines <= visibleLines) return;             // fits in the window
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

    // ---- Caption text from native text tracks ------------------------------
    const wiredTracks = new WeakSet();
    const renderCues = (track) => {
      const cues = track.activeCues;
      if (!cues || !cues.length) { hasText = false; scroll.replaceChildren(); stopScroll(); visible(); return; }
      const frag = document.createDocumentFragment();
      for (let i = 0; i < cues.length; i++) {
        if (i) frag.appendChild(document.createElement('br'));
        try { frag.appendChild(cues[i].getCueAsHTML()); }
        catch (_) { frag.appendChild(document.createTextNode(cues[i].text || '')); }
      }
      scroll.replaceChildren(frag);
      hasText = true; size(); visible(); startScroll();
    };
    const wire = (track) => {
      if (wiredTracks.has(track)) return;
      wiredTracks.add(track);
      track.addEventListener('cuechange', () => { if (ccOn) renderCues(track); });
    };
    const sync = () => {
      let on = false;
      for (const t of video.textTracks) {
        if (t.kind !== 'captions' && t.kind !== 'subtitles') continue;
        if (t.mode === 'showing') t.mode = 'hidden';       // stop native drawing, keep cue events
        if (t.mode === 'hidden') { on = true; wire(t); renderCues(t); }
      }
      ccOn = on;
      if (!ccOn) { hasText = false; scroll.replaceChildren(); stopScroll(); }
      visible();
    };
    video.textTracks.addEventListener('addtrack', sync);
    video.textTracks.addEventListener('removetrack', sync);
    video.textTracks.addEventListener('change', sync);
    sync();

    // ---- Hover open/close with a 1s close delay ----------------------------
    box.addEventListener('pointerenter', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      open = true; box.classList.add('pcr-open'); visible();
    });
    box.addEventListener('pointerleave', () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => { hoverTimer = null; open = false; box.classList.remove('pcr-open'); visible(); }, 1000);
    });

    // ---- Drag to reposition (grab the box, not the handle/toolbar) ---------
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
        dragging = false; persist(); visible();
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
    });

    // ---- Corner drag to resize the container (free-form, centre-anchored) ---
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const rect = container.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, sw = style.widthPct, sh = style.heightPct;
      dragging = true; handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        // Centre-anchored: the box grows symmetrically, so the grabbed corner
        // tracks the cursor while width/height change by 2x the drag delta.
        style.widthPct = clamp(sw + 2 * (ev.clientX - sx) / rect.width * 100, 15, 95);
        style.heightPct = clamp(sh + 2 * (ev.clientY - sy) / rect.height * 100, 6, 90);
        size();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        dragging = false; persist(); startScroll(); visible();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });

    // ---- Toolbar controls --------------------------------------------------
    fontRange.addEventListener('input', () => {
      style.fontPx = clamp(parseInt(fontRange.value, 10) || DEFAULTS.fontPx, 10, 72);
      apply(); persist(); startScroll();
    });
    textPick.addEventListener('input', () => { style.textColor = textPick.value.toUpperCase(); apply(); persist(); });
    bgPick.addEventListener('input', () => { style.bgColor = bgPick.value.toUpperCase(); apply(); persist(); });
    bgAlpha.addEventListener('input', () => { style.bgAlpha = clamp(bgAlpha.value / 100, 0, 1); apply(); persist(); });
    auto.addEventListener('change', () => {
      style.autoscroll = auto.checked; apply(); persist();
      if (style.autoscroll) startScroll(); else stopScroll();
    });
    reset.addEventListener('click', () => {
      Object.assign(style, DEFAULTS); apply(); persist(); visible();
      if (style.autoscroll) startScroll(); else stopScroll();
    });
  }

  // ---- Watch for videos (SPA navigation creates/destroys them) ------------
  // Inspect only the ADDED nodes of each mutation rather than re-scanning the
  // whole document, so ordinary DOM churn stays cheap.
  const onMutations = (records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO') attach(node);
        else if (node.querySelectorAll) node.querySelectorAll('video').forEach(attach);
      }
    }
  };
  new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('video').forEach(attach);
})();

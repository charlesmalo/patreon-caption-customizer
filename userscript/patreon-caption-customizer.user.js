// ==UserScript==
// @name         Patreon Caption Customizer — Move, Resize & Recolor Captions & Subtitles Text
// @namespace    local
// @version      2.4
// @description  Drag Patreon captions/subtitles anywhere, resize the font, set text + background color and opacity, and optionally auto-scroll long captions within a 2-line window. Controls flip to stay on screen. Everything persists across videos and reloads.
// @match        https://www.patreon.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==
/**
 * Patreon Caption Customizer
 * ==========================
 *
 * WHAT IT DOES
 *   Replaces Patreon's fixed, bottom-anchored captions with a caption box you
 *   can freely reposition, resize, and fully recolor — text color/opacity and
 *   background color/opacity — similar to YouTube's draggable captions. Your
 *   settings are saved and reused across videos and page reloads until changed.
 *
 * HOW TO USE (once installed in Tampermonkey / Violentmonkey)
 *   1. Open a Patreon video and turn captions on with the player's CC button.
 *   2. MOVE   : click-drag the caption box anywhere over the video.
 *   3. RESIZE : drag the small square handle at the box's bottom-right corner —
 *               outward = larger font, inward = smaller font.
 *   4. RECOLOR: hover the box to reveal a toolbar with, for both the TEXT and
 *               the BOX background, a color picker + an opacity slider, plus a
 *               Reset button.
 *   The toolbar flips to whichever side keeps it on screen: it sits BELOW the
 *   box when the box is in the top half of the video, and ABOVE it in the
 *   bottom half — so the controls never overflow off the top of the frame.
 *   The box only appears while a caption is on screen, but stays visible while
 *   you are actively dragging, resizing, or using the toolbar.
 *
 * ABOUT COLOR + OPACITY (why two controls)
 *   The native HTML color picker (<input type="color">) is RGB-only and has no
 *   alpha channel, so transparency is provided by a companion opacity slider.
 *   The color + opacity are composed into an rgba() value at render time. The
 *   native picker still lets you type a #FFFFFF-style hex in its popup.
 *
 * LONG CAPTIONS (2-line auto-scroll)
 *   The box shows up to two lines at a time. If a caption is longer, it scrolls
 *   upward one line at a time (line 2 becomes line 1, line 3 becomes line 2,
 *   and so on), pausing to read each two-line window. The pause is proportional
 *   to how much of the caption that window shows — a window showing the whole
 *   caption reads for about 3 seconds. The scroll resets when the caption
 *   changes. Toggle this with the toolbar's "Auto-scroll" checkbox; when it is
 *   off, long captions are shown in full instead (the box grows to fit).
 *
 * HOW IT WORKS
 *   Patreon renders captions through the browser's native WebVTT text tracks.
 *   This script sets the active caption track to `mode = "hidden"` — that stops
 *   the browser from drawing the captions itself while still firing `cuechange`
 *   events — then renders each active cue into its own absolutely-positioned
 *   overlay <div> that we control. Position is stored as a percentage of the
 *   player, so it holds through window resizing and fullscreen. A
 *   MutationObserver re-attaches the overlay as Patreon's single-page app swaps
 *   video elements in and out.
 *
 * PRIVACY / SAFETY
 *   No network requests, no tracking, no personal data. All state lives in a
 *   single localStorage key in your own browser.
 *
 * CONFIGURATION
 *   Tweak the DEFAULTS object below to change the starting appearance.
 *     xPct / yPct : caption box CENTER, as a percentage of the video area
 *                   (x: 0 = left, 100 = right | y: 0 = top, 100 = bottom).
 *     fontPx      : starting font size in pixels (drag-resize clamps to 10–72).
 *     textColor   : text color as a 6-digit hex string.
 *     textAlpha   : text opacity, 0 (transparent) to 1 (opaque).
 *     bgColor     : background box color as a 6-digit hex string.
 *     bgAlpha     : background opacity, 0 (transparent) to 1 (opaque).
 *     autoscroll  : true to scroll long captions within a 2-line window;
 *                   false to show them in full.
 *   The toolbar's Reset button (or deleting the localStorage key
 *   "patreon-caption-style-v2") restores these defaults.
 *
 * @license MIT
 */
(function () {
  'use strict';

  // ---- Persisted style (global; survives reloads) --------------------------
  // The single source of truth for the caption box. Loaded on start, written
  // back to localStorage whenever the user finishes a drag/resize/color change.
  const LS_KEY = 'patreon-caption-style-v2';
  const DEFAULTS = {
    xPct: 50, yPct: 88, fontPx: 22,
    textColor: '#FFFFFF', textAlpha: 1,     // characters
    bgColor: '#000000', bgAlpha: 0.55,      // background box
    autoscroll: true,                       // scroll long captions in a 2-line window
  };
  const load = () => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (_) {}
    // Migrate the v2.0 single `color` field to the new textColor field.
    if (saved.color && !saved.textColor) saved.textColor = saved.color;
    return Object.assign({}, DEFAULTS, saved);
  };
  const style = load();
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(style)); } catch (_) {} };

  // Small helpers.
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
  // Compose a #RRGGBB hex + 0..1 alpha into an rgba() string.
  const rgba = (hex, a) => {
    const n = parseInt((isHex(hex) ? hex : '#000000').slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
  };

  // ---- Styles --------------------------------------------------------------
  // .pcr-box    : the draggable caption box (shown only via the .pcr-on class).
  // .pcr-handle : bottom-right resize grip that scales the font.
  // .pcr-bar    : hover-only toolbar with text + background color/opacity rows.
  const CSS = `
  .pcr-box{position:absolute;z-index:2147483000;transform:translate(-50%,-50%);
    max-width:80%;padding:.15em .5em;border-radius:4px;font-family:inherit;
    line-height:1.3;text-align:center;text-shadow:0 0 3px #000,0 0 3px #000;
    cursor:move;user-select:none;pointer-events:auto;display:none;white-space:pre-wrap;}
  .pcr-box.pcr-on{display:block;}
  .pcr-text{pointer-events:none;}
  /* When auto-scroll is on, clip to a two-line window; longer captions scroll. */
  .pcr-box.pcr-scroll-on .pcr-text{overflow:hidden;max-height:2.6em;}
  .pcr-scroll{will-change:transform;}
  .pcr-handle{position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;
    border:2px solid rgba(255,255,255,.85);border-radius:3px;background:rgba(0,0,0,.55);
    cursor:nwse-resize;pointer-events:auto;}
  .pcr-bar{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);
    display:none;flex-direction:column;gap:5px;margin-bottom:2px;padding:6px 8px;
    border-radius:6px;background:rgba(18,18,18,.96);box-shadow:0 2px 10px rgba(0,0,0,.6);
    white-space:nowrap;font-family:sans-serif;cursor:default;text-shadow:none;}
  .pcr-box:hover .pcr-bar{display:flex;}
  /* When the box sits in the top half of the video, drop the toolbar below it
     so it never overflows off the top edge of the frame. */
  .pcr-box.pcr-flip .pcr-bar{top:100%;bottom:auto;margin-top:2px;margin-bottom:0;}
  .pcr-row{display:flex;align-items:center;gap:6px;}
  .pcr-row label{font:11px sans-serif;color:#ddd;width:32px;flex:0 0 auto;}
  .pcr-pick{width:26px;height:20px;padding:0;border:1px solid #555;border-radius:3px;
    background:#0d0d0d;cursor:pointer;flex:0 0 auto;}
  .pcr-alpha{width:96px;}
  .pcr-pct{font:11px monospace;color:#bbb;width:34px;text-align:right;flex:0 0 auto;}
  .pcr-check{display:flex;align-items:center;gap:6px;cursor:pointer;font:11px sans-serif;color:#ddd;}
  .pcr-check input{cursor:pointer;}
  .pcr-reset{align-self:flex-end;font:12px sans-serif;padding:2px 8px;cursor:pointer;
    border-radius:3px;border:1px solid #555;background:#242424;color:#fff;}
  .pcr-reset:hover{background:#333;}`;
  (document.head || document.documentElement).appendChild(
    Object.assign(document.createElement('style'), { textContent: CSS }));

  // Build one "color picker + opacity slider + %" row for the toolbar.
  const makeRow = (labelText) => {
    const row = document.createElement('div');
    row.className = 'pcr-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const pick = document.createElement('input');
    pick.type = 'color'; pick.className = 'pcr-pick';
    const alpha = document.createElement('input');
    alpha.type = 'range'; alpha.className = 'pcr-alpha';
    alpha.min = '0'; alpha.max = '100'; alpha.step = '1';
    const pct = document.createElement('span');
    pct.className = 'pcr-pct';
    row.append(label, pick, alpha, pct);
    return { row, pick, alpha, pct };
  };

  // ---- Per-video controller ------------------------------------------------
  // Each <video> gets its own overlay + track wiring exactly once.
  const seen = new WeakSet();

  function attach(video) {
    if (seen.has(video)) return;
    seen.add(video);

    // Anchor the overlay to the player root so it stays visible in fullscreen
    // (the root is normally the element that goes fullscreen). Ensure it is a
    // positioned ancestor so our absolute positioning is relative to it.
    const container = video.closest('[class*="VideoPlayerRoot"]') || video.parentElement;
    if (!container) return;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    // Never stack overlays: clear any overlay left by a previous video here.
    container.querySelectorAll(':scope > .pcr-box').forEach((el) => el.remove());

    // --- Build the overlay DOM ---
    const box = document.createElement('div');
    box.className = 'pcr-box';
    const text = document.createElement('div');
    text.className = 'pcr-text';                    // fixed 2-line viewport
    const scroll = document.createElement('div');   // inner element we translate up
    scroll.className = 'pcr-scroll';
    text.appendChild(scroll);
    const handle = document.createElement('div');
    handle.className = 'pcr-handle';
    const bar = document.createElement('div');
    bar.className = 'pcr-bar';
    const textCtl = makeRow('Text');   // character color + opacity
    const bgCtl = makeRow('Box');      // background color + opacity
    const autoRow = document.createElement('label');
    autoRow.className = 'pcr-check';
    const auto = document.createElement('input');
    auto.type = 'checkbox';
    const autoLbl = document.createElement('span');
    autoLbl.textContent = 'Auto-scroll long captions';
    autoRow.append(auto, autoLbl);
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'pcr-reset'; reset.textContent = 'Reset';
    bar.append(textCtl.row, bgCtl.row, autoRow, reset);
    box.append(bar, text, handle);
    container.appendChild(box);

    // --- Per-video visibility state ---
    // ccOn       : captions are currently enabled on this video.
    // hasText    : a caption cue is on screen right now.
    // interacting: user is dragging/resizing or using the toolbar (keeps the
    //              box alive so it never vanishes mid-action).
    let ccOn = false, hasText = false, interacting = false;

    // Push the current `style` values onto the DOM + toolbar controls.
    const apply = () => {
      box.style.left = style.xPct + '%';
      box.style.top = style.yPct + '%';
      box.style.fontSize = style.fontPx + 'px';
      box.style.color = rgba(style.textColor, style.textAlpha);
      box.style.background = rgba(style.bgColor, style.bgAlpha);
      // Top half of the video → toolbar below the box; bottom half → above it.
      box.classList.toggle('pcr-flip', style.yPct < 50);
      box.classList.toggle('pcr-scroll-on', style.autoscroll);
      auto.checked = style.autoscroll;
      textCtl.pick.value = style.textColor;
      bgCtl.pick.value = style.bgColor;
      textCtl.alpha.value = Math.round(style.textAlpha * 100);
      bgCtl.alpha.value = Math.round(style.bgAlpha * 100);
      textCtl.pct.textContent = Math.round(style.textAlpha * 100) + '%';
      bgCtl.pct.textContent = Math.round(style.bgAlpha * 100) + '%';
    };
    // Slim position-only update used during dragging (avoids touching colors,
    // toolbar inputs, etc. on every pointermove).
    const place = () => {
      box.style.left = style.xPct + '%';
      box.style.top = style.yPct + '%';
      box.classList.toggle('pcr-flip', style.yPct < 50);
    };
    // Show the box only when captions exist, unless the user is interacting.
    const visible = () => box.classList.toggle('pcr-on', ccOn && (hasText || interacting));
    apply(); visible();

    // ---- Two-line auto-scroll ----------------------------------------------
    // Clip captions to a 2-line window; if a cue is taller, scroll it up one
    // line at a time. The pause per step is the share of the string visible in
    // the 2-line window (≈ 2 / totalLines) × 3s, so a caption that fully fits
    // in the window reads for ~3s. Floored so long captions don't fly by.
    let scrollTimer = null, scrollRaf = null;
    const stopScroll = () => {
      if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null; }
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
      scroll.style.transition = 'none';
      scroll.style.transform = 'translateY(0)';
    };
    const startScroll = () => {
      stopScroll();                                      // cancels any pending timer + rAF
      if (!style.autoscroll) return;                     // feature disabled by user
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        const lh = parseFloat(getComputedStyle(scroll).lineHeight) || style.fontPx * 1.3;
        const lines = Math.max(1, Math.round(scroll.scrollHeight / lh));
        if (lines <= 2) return;                          // fits within the window
        const stepDelay = Math.max(600, (2 / lines) * 3000);
        const maxStep = lines - 2;                       // last window shows the final 2 lines
        let step = 0;
        const advance = () => {
          step++;
          scroll.style.transition = 'transform .3s ease';
          scroll.style.transform = `translateY(${-step * lh}px)`;
          scrollTimer = step < maxStep ? setTimeout(advance, stepDelay) : null;
        };
        scrollTimer = setTimeout(advance, stepDelay);    // read the first window, then scroll
      });
    };

    // ---- Caption text from native text tracks (rendered by us) -------------
    const wiredTracks = new WeakSet();

    // Render the track's currently-active cues into our overlay.
    const renderCues = (track) => {
      const cues = track.activeCues;
      if (!cues || !cues.length) { hasText = false; scroll.replaceChildren(); stopScroll(); visible(); return; }
      const frag = document.createDocumentFragment();
      for (let i = 0; i < cues.length; i++) {
        if (i) frag.appendChild(document.createElement('br'));
        // getCueAsHTML() safely preserves WebVTT markup; fall back to plain text.
        try { frag.appendChild(cues[i].getCueAsHTML()); }
        catch (_) { frag.appendChild(document.createTextNode(cues[i].text || '')); }
      }
      scroll.replaceChildren(frag);
      hasText = true; visible(); startScroll();
    };

    // Attach a cuechange listener to a track a single time.
    const wire = (track) => {
      if (wiredTracks.has(track)) return;
      wiredTracks.add(track);
      track.addEventListener('cuechange', () => { if (ccOn) renderCues(track); });
    };

    // Keep caption tracks in "hidden" mode: the browser stops drawing them
    // (no double captions) but still fires cue events we render ourselves.
    const sync = () => {
      let on = false;
      for (const t of video.textTracks) {
        if (t.kind !== 'captions' && t.kind !== 'subtitles') continue;
        if (t.mode === 'showing') t.mode = 'hidden';
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

    // ---- Drag to reposition (grab anywhere except the handle/toolbar) ------
    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pcr-handle') || e.target.closest('.pcr-bar')) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      // Preserve the grab offset so the box doesn't jump under the cursor.
      const cx = style.xPct / 100 * rect.width, cy = style.yPct / 100 * rect.height;
      const gx = e.clientX - rect.left - cx, gy = e.clientY - rect.top - cy;
      interacting = true; box.setPointerCapture(e.pointerId);
      const move = (ev) => {
        style.xPct = clamp((ev.clientX - rect.left - gx) / rect.width * 100, 2, 98);
        style.yPct = clamp((ev.clientY - rect.top - gy) / rect.height * 100, 4, 96);
        place();
      };
      const up = () => {
        box.removeEventListener('pointermove', move);
        box.removeEventListener('pointerup', up);
        interacting = false; persist(); visible();
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
    });

    // ---- Corner drag to resize the font ------------------------------------
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, sf = style.fontPx;
      interacting = true; handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        // Average of horizontal + vertical drag: out (down-right) = bigger.
        const d = ((ev.clientX - sx) + (ev.clientY - sy)) / 2;
        style.fontPx = clamp(Math.round(sf + d * 0.2), 10, 72);
        apply();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        interacting = false; persist(); visible();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });

    // ---- Toolbar: text + background color / opacity, and reset -------------
    // Hovering the toolbar counts as "interacting" so the box stays put even if
    // the caption cue ends while you're adjusting colors.
    bar.addEventListener('pointerenter', () => { interacting = true; visible(); });
    bar.addEventListener('pointerleave', () => { interacting = false; visible(); });

    textCtl.pick.addEventListener('input', () => {
      style.textColor = textCtl.pick.value.toUpperCase(); apply(); persist();
    });
    bgCtl.pick.addEventListener('input', () => {
      style.bgColor = bgCtl.pick.value.toUpperCase(); apply(); persist();
    });
    textCtl.alpha.addEventListener('input', () => {
      style.textAlpha = clamp(textCtl.alpha.value / 100, 0, 1); apply(); persist();
    });
    bgCtl.alpha.addEventListener('input', () => {
      style.bgAlpha = clamp(bgCtl.alpha.value / 100, 0, 1); apply(); persist();
    });
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
  // whole document. Ordinary DOM churn — including our own caption text
  // updates, which add no <video> — therefore costs next to nothing.
  const onMutations = (records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;                      // elements only
        if (node.tagName === 'VIDEO') attach(node);
        else if (node.querySelectorAll) node.querySelectorAll('video').forEach(attach);
      }
    }
  };
  new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('video').forEach(attach);           // videos already present
})();

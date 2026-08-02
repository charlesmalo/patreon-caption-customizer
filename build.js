/**
 * Build step — one source, three artifacts.
 * -----------------------------------------
 * `src/caption-customizer.js` is the single source of truth (the IIFE). This
 * script wraps/copies it into each subproject:
 *   • userscript/         – prepends the Tampermonkey/Greasemonkey metadata
 *   • chrome-extension/   – copies it to content.js (Chrome / Opera / Edge)
 *   • firefox-extension/  – copies it to content.js (Firefox)
 * It also generates placeholder PNG icons and syncs the @version from the
 * userscript header into both extension manifests, so the version lives in one
 * place. The dev-only test suite (test/) is never copied into an artifact.
 *
 * Run:  node build.js   (or: npm run build)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'caption-customizer.js'), 'utf8');
const HEADER = fs.readFileSync(path.join(ROOT, 'userscript', 'userscript-header.txt'), 'utf8');
const VERSION = (HEADER.match(/@version\s+([^\s]+)/) || [])[1] || '0.0';

// ---- 1) Userscript (Tampermonkey / Greasemonkey) ---------------------------
fs.writeFileSync(path.join(ROOT, 'userscript', 'patreon-caption-customizer.user.js'), HEADER + SRC);

// ---- 2 & 3) Extension content scripts --------------------------------------
const genHeader = '/* Auto-generated from ../src/caption-customizer.js by build.js — do not edit directly. */\n';
for (const dir of ['chrome-extension', 'firefox-extension']) {
  fs.mkdirSync(path.join(ROOT, dir, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, dir, 'content.js'), genHeader + SRC);
  // Keep manifest "version" in sync with the userscript @version.
  const mfPath = path.join(ROOT, dir, 'manifest.json');
  if (fs.existsSync(mfPath)) {
    const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
    mf.version = VERSION;
    fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2) + '\n');
  }
}

// ---- Minimal solid-color PNG encoder (placeholder icons) -------------------
const crc32 = (buf) => {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};
const png = (size, [r, g, b, a]) => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit depth, RGBA
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) { row[1 + x * 4] = r; row[2 + x * 4] = g; row[3 + x * 4] = b; row[4 + x * 4] = a; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
// Only write a placeholder when an icon is MISSING — never overwrite real
// artwork. Real icons are generated from CyberCaptionsCustomizer.png via
// `npm run icons` (see scripts/gen-icons.sh).
const COLOR = [24, 24, 24, 255];
for (const size of [16, 32, 48, 96, 128]) {
  for (const dir of ['chrome-extension', 'firefox-extension']) {
    const p = path.join(ROOT, dir, 'icons', `icon-${size}.png`);
    if (!fs.existsSync(p)) fs.writeFileSync(p, png(size, COLOR));
  }
}

console.log(`Built v${VERSION}: userscript + chrome-extension + firefox-extension (content.js, icons, synced manifest versions).`);

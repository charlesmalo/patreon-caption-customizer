/**
 * Background service worker (MV3).
 * -------------------------------
 * Two small jobs, no data collection, no network:
 *   1. Clicking the toolbar icon opens the settings dashboard (options page).
 *   2. On startup/install, re-register content scripts for any user-added
 *      custom sites the user has already granted host access to, so the overlay
 *      runs there. Curated sites are handled by the static manifest matches.
 */
'use strict';

const SETTINGS_KEY = 'ccc-settings-v3';

chrome.action.onClicked.addListener(() => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
});

async function registerCustomSites() {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = data && data[SETTINGS_KEY];
    const sites = (settings && Array.isArray(settings.customSites)) ? settings.customSites : [];
    if (!sites.length || !chrome.scripting || !chrome.scripting.registerContentScripts) return;

    const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
    const have = new Set(existing.map((s) => s.id));

    for (const domain of sites) {
      const id = 'ccc-' + String(domain).replace(/[^a-z0-9.]/gi, '-');
      if (have.has(id)) continue;
      const origins = [`*://${domain}/*`, `*://*.${domain}/*`];
      // Only register where the user has actually granted access.
      const granted = await chrome.permissions.contains({ origins }).catch(() => false);
      if (!granted) continue;
      await chrome.scripting.registerContentScripts([{
        id, matches: origins, js: ['content.js'], runAt: 'document_start', allFrames: true,
      }]).catch(() => {});
    }
  } catch (_) { /* best effort */ }
}

chrome.runtime.onInstalled.addListener(registerCustomSites);
chrome.runtime.onStartup.addListener(registerCustomSites);

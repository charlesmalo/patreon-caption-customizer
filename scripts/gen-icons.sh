#!/usr/bin/env bash
# Regenerate the extension icons from the root source logo.
# Uses macOS `sips` (no external dependencies). Run: npm run icons
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="CyberCaptionsCustomizer.png"
[ -f "$SRC" ] || { echo "Source logo '$SRC' not found in repo root."; exit 1; }

for size in 16 32 48 96 128; do
  sips -s format png -z "$size" "$size" "$SRC" \
    --out "chrome-extension/icons/icon-$size.png" >/dev/null
  cp "chrome-extension/icons/icon-$size.png" "firefox-extension/icons/icon-$size.png"
done

echo "Icons regenerated from $SRC into chrome-extension/icons and firefox-extension/icons."

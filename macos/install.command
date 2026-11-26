#!/bin/bash
# Fallback installer, no app needed. Right click this file and choose Open if macOS blocks a double click.
echo "Kokoro Reader installer"
curl -fsSL https://raw.githubusercontent.com/hareesh-r/kokoro-reader/main/install.sh | bash
mkdir -p "$HOME/Kokoro Reader"
echo
echo "In Chrome open chrome://extensions, turn on Developer mode, click Load unpacked,"
echo "and pick the extension folder from the Kokoro Reader download (or unzip the extension zip from the release page)."
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
echo
read -n 1 -s -r -p "Press any key to close this window."

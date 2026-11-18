#!/bin/bash
# Runs inside Terminal, started by the Install Kokoro Reader app.
cd "$(dirname "$0")"
if ! command -v git >/dev/null 2>&1; then
  echo "Git is needed first. A macOS prompt will ask to install the developer tools."
  echo "When it finishes, open Install Kokoro Reader again."
  xcode-select --install 2>/dev/null || true
  read -n 1 -s -r -p "Press any key to close this window."
  exit 1
fi
bash ./install.sh
echo
echo "Extension folder: $HOME/Kokoro Reader/extension"
echo "In Chrome turn on Developer mode, click Load unpacked, and pick that folder."
open "$HOME/Kokoro Reader" 2>/dev/null || true
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
echo
read -n 1 -s -r -p "Press any key to close this window."

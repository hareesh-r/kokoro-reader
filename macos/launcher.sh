#!/bin/bash
# App entry point. Copies the extension to ~/Kokoro Reader and runs the installer in Terminal.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
WORK="$(mktemp -d)"
cp -R "$RES/." "$WORK/"
mkdir -p "$HOME/Kokoro Reader"
rm -rf "$HOME/Kokoro Reader/extension"
cp -R "$WORK/extension" "$HOME/Kokoro Reader/extension"
osascript <<OSA
tell application "Terminal"
  activate
  do script "bash '$WORK/run.sh'"
end tell
OSA

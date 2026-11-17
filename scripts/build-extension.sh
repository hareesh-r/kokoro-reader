#!/usr/bin/env bash
# Builds dist/kokoro-reader-extension-<version>.zip (load unpacked from the folder, or zip for sharing).
set -euo pipefail
cd "$(dirname "$0")/.."
V="$(grep -m1 '"version"' extension/manifest.json | sed -E 's/.*: *"([^"]+)".*/\1/')"
mkdir -p dist
rm -f "dist/kokoro-reader-extension-$V.zip"
( cd extension && zip -qr "../dist/kokoro-reader-extension-$V.zip" . -x '*.DS_Store' )
echo "dist/kokoro-reader-extension-$V.zip"

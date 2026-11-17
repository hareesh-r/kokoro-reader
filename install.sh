#!/usr/bin/env bash
# One line installer:
#   curl -fsSL https://raw.githubusercontent.com/hareesh-r/kokoro-reader/main/install.sh | bash
set -euo pipefail
RAW="${KOKORO_READER_RAW:-https://raw.githubusercontent.com/hareesh-r/kokoro-reader/main}"
DEST="$HOME/.local/bin"
mkdir -p "$DEST"
if [ -f "$(dirname "$0")/server/kokoro-reader" ] 2>/dev/null; then
  cp "$(dirname "$0")/server/kokoro-reader" "$DEST/kokoro-reader"
else
  curl -fsSL "$RAW/server/kokoro-reader" -o "$DEST/kokoro-reader"
fi
chmod +x "$DEST/kokoro-reader"
exec "$DEST/kokoro-reader" install "$@"

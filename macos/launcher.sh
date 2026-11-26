#!/bin/bash
# App entry point. Copies the extension to ~/Kokoro Reader and runs the installer in Terminal.
# Everything is logged to ~/Library/Logs/KokoroReaderInstaller.log
LOG="$HOME/Library/Logs/KokoroReaderInstaller.log"
mkdir -p "$HOME/Library/Logs"
exec >>"$LOG" 2>&1
echo "=== $(date) launcher start"

fail() {
  echo "FAILED: $1"
  /usr/bin/osascript -e "display dialog \"$1\n\nDetails: ~/Library/Logs/KokoroReaderInstaller.log\" with title \"Kokoro Reader\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
  exit 1
}

RES="$(cd "$(dirname "$0")/../Resources" 2>/dev/null && pwd)"
[ -d "$RES" ] || fail "The installer files are missing from the app. Download the dmg again."

WORK="$(mktemp -d /tmp/kokoro-reader.XXXXXX)" || fail "Could not create a temporary folder."
cp -R "$RES/." "$WORK/" || fail "Could not copy the installer files."
mkdir -p "$HOME/Kokoro Reader" || fail "Could not create the Kokoro Reader folder in your home folder."
rm -rf "$HOME/Kokoro Reader/extension"
cp -R "$WORK/extension" "$HOME/Kokoro Reader/extension" || fail "Could not copy the extension."

# Files copied out of a downloaded app keep the quarantine flag, which would make Terminal refuse to run them.
/usr/bin/xattr -cr "$WORK" "$HOME/Kokoro Reader/extension" 2>/dev/null

CMD="$WORK/Install Kokoro Reader.command"
printf '#!/bin/bash\nexec bash "%s/run.sh"\n' "$WORK" > "$CMD"
chmod +x "$CMD" "$WORK/run.sh" "$WORK/install.sh" "$WORK/server/kokoro-reader" 2>/dev/null

# open -a needs no Automation permission, unlike telling Terminal what to do with AppleScript.
if ! /usr/bin/open -a Terminal "$CMD"; then
  fail "Could not open Terminal. Open Terminal yourself and paste: curl -fsSL https://raw.githubusercontent.com/hareesh-r/kokoro-reader/main/install.sh | bash"
fi
echo "Terminal opened with $CMD"

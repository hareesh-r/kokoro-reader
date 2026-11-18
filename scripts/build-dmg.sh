#!/usr/bin/env bash
# Builds dist/KokoroReader-<version>.dmg. Run on macOS (needs hdiutil).
set -euo pipefail
cd "$(dirname "$0")/.."
V="$(grep -m1 '"version"' extension/manifest.json | sed -E 's/.*: *"([^"]+)".*/\1/')"
STAGE="dist/dmg"
APP="$STAGE/Install Kokoro Reader.app"
rm -rf "$STAGE"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>CFBundleName</key><string>Install Kokoro Reader</string>
 <key>CFBundleDisplayName</key><string>Install Kokoro Reader</string>
 <key>CFBundleIdentifier</key><string>com.kokoro-reader.installer</string>
 <key>CFBundleExecutable</key><string>launcher</string>
 <key>CFBundleIconFile</key><string>AppIcon</string>
 <key>CFBundlePackageType</key><string>APPL</string>
 <key>CFBundleShortVersionString</key><string>$V</string>
 <key>CFBundleVersion</key><string>$V</string>
 <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
P

cp macos/launcher.sh "$APP/Contents/MacOS/launcher"; chmod +x "$APP/Contents/MacOS/launcher"
cp macos/run.sh install.sh "$APP/Contents/Resources/"
mkdir -p "$APP/Contents/Resources/server"; cp server/kokoro-reader "$APP/Contents/Resources/server/"
chmod +x "$APP/Contents/Resources/run.sh" "$APP/Contents/Resources/install.sh"
cp -R extension "$APP/Contents/Resources/extension"
find "$APP" -name .DS_Store -delete

if command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
  I="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$I"
  for s in 16 32 64 128; do sips -z $s $s extension/icon128.png --out "$I/icon_${s}x${s}.png" >/dev/null; done
  cp "$I/icon_32x32.png" "$I/icon_16x16@2x.png"; cp "$I/icon_64x64.png" "$I/icon_32x32@2x.png"
  rm "$I/icon_64x64.png"
  iconutil -c icns "$I" -o "$APP/Contents/Resources/AppIcon.icns" || true
fi

cp macos/README.txt "$STAGE/READ ME FIRST.txt"
command -v codesign >/dev/null 2>&1 && codesign --force --deep --sign - "$APP" || true

if command -v hdiutil >/dev/null 2>&1; then
  OUT="dist/KokoroReader-$V.dmg"; rm -f "$OUT"
  hdiutil create -volname "Kokoro Reader" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
  echo "$OUT"
else
  echo "hdiutil not found: staged app at $STAGE only (run this on macOS to produce the dmg)"
fi

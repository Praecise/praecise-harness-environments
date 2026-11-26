#!/bin/sh
# Build Praecise Control.app for macOS: the helper as an app in the menu bar.
#
#   ./build-app.sh [folder]                         default: this folder
#   EDITION=/path/to/edition.json ./build-app.sh    the same program as another edition, from its own file
#   SIGN="Developer ID Application: Name (TEAM)" ./build-app.sh
#   SIGN=... NOTARY_PROFILE=profile ./build-app.sh   also notarize and staple
#
# One file, one compiler job per architecture, at the lowest priority. Unsigned unless
# SIGN names an identity; permissions a Mac grants an app attach to its signature, so an
# unsigned build is asked for them again after every build.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-"$here"}
# The edition: the same program under the name, id and mark its file in ../../editions gives it.
case "${EDITION:-praecise}" in
  */*|*.json) edition=$EDITION ;;
  *) edition="$here/../../editions/${EDITION:-praecise}.json" ;;
esac
from=$(cd "$(dirname "$edition")" && pwd)
value() { /usr/bin/python3 -c 'import json,sys; v=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."): v=v.get(k,"") if isinstance(v,dict) else ""
print(v)' "$edition" "$1"; }
name=$(value name)
executable=$(value executable)
app="$out/$name.app"
made=$(mktemp -d)
trap 'rm -rf "$made"' EXIT
# Compiled first: a build that fails leaves the app that was there as it was.
for arch in arm64 x86_64; do
  nice -n 20 xcrun swiftc -swift-version 6 -O -j 1 -target "$arch-apple-macos14.0" "$here/main.swift" -o "$made/$arch"
done
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$from/$(value icon)" "$app/Contents/Resources/$executable.icns"
[ -z "$(value menubar)" ] || cp "$from/$(value menubar)" "$app/Contents/Resources/menubar.png"
cp "$here/Info.plist" "$app/Contents/Info.plist"
plist() { /usr/libexec/PlistBuddy -c "$1" "$app/Contents/Info.plist"; }
plist "Set :CFBundleName $name"
plist "Set :CFBundleDisplayName $name"
plist "Set :CFBundleIdentifier $(value appId)"
plist "Set :CFBundleExecutable $executable"
plist "Set :CFBundleIconFile $executable"
[ -z "$(value by)" ] || plist "Add :PraeciseControlBy string $(value by)"
[ -z "$(value usage.accessibility)" ] || plist "Add :NSAccessibilityUsageDescription string $(value usage.accessibility)"
[ -z "$(value usage.screenRecording)" ] || plist "Add :NSScreenCaptureUsageDescription string $(value usage.screenRecording)"
lipo -create "$made/arm64" "$made/x86_64" -output "$app/Contents/MacOS/$executable"
if [ -n "${SIGN:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$SIGN" "$app"
  codesign --verify --strict "$app"
  if [ -n "${NOTARY_PROFILE:-}" ]; then
    zip="$made/app.zip"
    ditto -c -k --keepParent "$app" "$zip"
    xcrun notarytool submit "$zip" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$app"
  fi
fi
echo "$app"

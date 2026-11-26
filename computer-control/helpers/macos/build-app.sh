#!/bin/sh
# Build Praecise Control.app for macOS: the helper as an app in the menu bar.
#
#   ./build-app.sh [folder]                         default: this folder
#   SIGN="Developer ID Application: Name (TEAM)" ./build-app.sh
#   SIGN=... NOTARY_PROFILE=profile ./build-app.sh   also notarize and staple
#
# One file, one compiler job per architecture, at the lowest priority. Unsigned unless
# SIGN names an identity; permissions a Mac grants an app attach to its signature, so an
# unsigned build is asked for them again after every build.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-"$here"}
app="$out/Praecise Control.app"
made=$(mktemp -d)
trap 'rm -rf "$made"' EXIT
# Compiled first: a build that fails leaves the app that was there as it was.
for arch in arm64 x86_64; do
  nice -n 20 xcrun swiftc -swift-version 6 -O -j 1 -target "$arch-apple-macos14.0" "$here/main.swift" -o "$made/$arch"
done
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/../../assets/praecise-control.icns" "$app/Contents/Resources/praecise-control.icns"
cp "$here/Info.plist" "$app/Contents/Info.plist"
lipo -create "$made/arm64" "$made/x86_64" -output "$app/Contents/MacOS/praecise-control"
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

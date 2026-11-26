#!/bin/sh
# Build Praecise Control.app for macOS: the helper as an app in the menu bar.
#
#   ./build-app.sh [folder]                         default: this folder
#   EDITION=/path/to/edition.json ./build-app.sh    the same program as another edition, from its own file
#   RUNTIME=/folder/with/node ./build-app.sh        carry the runtime, so the app connects this computer itself
#   ARCHS=arm64 RUNTIME=... ./build-app.sh          for one kind of Mac only, with a runtime for that kind
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
# Both kinds of Mac in one program unless ARCHS names one. With the runtime inside, one kind each keeps the app small.
archs=${ARCHS:-"arm64 x86_64"}
for arch in $archs; do
  nice -n 20 xcrun swiftc -swift-version 6 -O -j 1 -target "$arch-apple-macos14.0" "$here/main.swift" "$here/route.swift" -o "$made/$arch"
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
[ -z "$(value store)" ] || plist "Add :PraeciseControlStore string $(value store)"
[ -z "$(value usage.accessibility)" ] || plist "Add :NSAccessibilityUsageDescription string $(value usage.accessibility)"
[ -z "$(value usage.screenRecording)" ] || plist "Add :NSScreenCaptureUsageDescription string $(value usage.screenRecording)"
# shellcheck disable=SC2046
lipo -create $(for arch in $archs; do printf '%s ' "$made/$arch"; done) -output "$app/Contents/MacOS/$executable"
cp "$edition" "$app/Contents/Resources/edition.json"
# The runtime, where one is given: Node for both kinds of Mac as one file, and the files it runs. With it
# the app connects this computer itself and keeps what is allowed on it; without it, it is the helper alone.
if [ -n "${RUNTIME:-}" ]; then
  harness=${HARNESS:-"$here/../../../node_modules/@praecise/harness"}
  mkdir -p "$app/Contents/Helpers" "$app/Contents/Resources/control/node_modules/@praecise/harness"
  cp "$RUNTIME/node" "$app/Contents/Helpers/node"
  for each in mcp.mjs index.ts inputs.ts browser.ts; do cp "$here/../../$each" "$app/Contents/Resources/control/$each"; done
  cp -R "$here/../../skills" "$app/Contents/Resources/control/skills"
  mkdir -p "$app/Contents/Resources/control/editions" && cp "$here/../../editions/praecise.json" "$app/Contents/Resources/control/editions/praecise.json"
  cp -RL "$harness/dist" "$app/Contents/Resources/control/node_modules/@praecise/harness/dist"
  cp -L "$harness/package.json" "$app/Contents/Resources/control/node_modules/@praecise/harness/package.json"
  find "$app/Contents/Resources/control" -name '*.map' -delete
fi
if [ -n "${SIGN:-}" ]; then
  # What is inside is signed first, with what the runtime needs said of it; then the app around it.
  [ ! -f "$app/Contents/Helpers/node" ] || codesign --force --options runtime --timestamp --entitlements "$here/node.entitlements" --sign "$SIGN" "$app/Contents/Helpers/node"
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

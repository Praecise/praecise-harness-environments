#!/bin/sh
# Build Praecise Control for Safari: the extension in browser/extension-page inside the
# small Mac app Safari needs it to come in. The project was made by Apple's converter.
#
#   TEAM=XXXXXXXXXX SIGN="Developer ID Application: Name (XXXXXXXXXX)" ./build.sh [folder]
#
# One job at the lowest priority. Signed for distribution outside the Mac App Store.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-"$here/build"}
: "${TEAM:?TEAM is the team id}" "${SIGN:?SIGN is the Developer ID Application identity}"
# From nothing every time: a build on top of an earlier one has been seen to sign a part with nothing it is entitled to.
rm -rf "$out"
cd "$here/Praecise Control for Safari"
nice -n 20 xcodebuild -project "Praecise Control for Safari.xcodeproj" -scheme "Praecise Control for Safari" -configuration Release \
  -derivedDataPath "$out" -jobs 1 DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$SIGN" \
  OTHER_CODE_SIGN_FLAGS="--timestamp" build -quiet
app="$out/Build/Products/Release/Praecise Control for Safari.app"
# A build leaves the entitlement that lets a debugger in, and an app with it is not notarized. Telling the
# build to leave it out leaves out the sandbox as well, so it is taken out here and each part signed again,
# the extension before the app that holds it.
held=$(mktemp -d)
trap 'rm -rf "$held"' EXIT
# Both are read before either is signed again: signing the extension changes what the app's own signature covers.
n=0
for part in "$app/Contents/PlugIns/"*.appex "$app"; do
  n=$((n + 1))
  codesign -d --entitlements - --xml "$part" > "$held/$n.plist" 2>/dev/null
  /usr/libexec/PlistBuddy -c "Delete :com.apple.security.get-task-allow" "$held/$n.plist" > /dev/null 2>&1 || true
done
n=0
for part in "$app/Contents/PlugIns/"*.appex "$app"; do
  n=$((n + 1))
  [ -s "$held/$n.plist" ] || { echo "could not read what $part is entitled to" >&2; exit 1; }
  codesign --force --options runtime --timestamp --entitlements "$held/$n.plist" --sign "$SIGN" "$part"
done
codesign --verify --deep --strict "$app"
echo "$app"

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
cd "$here/Praecise Control for Safari"
# No debugging entitlement in what is signed: an app with one is not notarized.
nice -n 20 xcodebuild -project "Praecise Control for Safari.xcodeproj" -scheme "Praecise Control for Safari" -configuration Release \
  -derivedDataPath "$out" -jobs 1 DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$SIGN" \
  CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO OTHER_CODE_SIGN_FLAGS="--timestamp" build -quiet
app="$out/Build/Products/Release/Praecise Control for Safari.app"
# A build leaves the entitlement that lets a debugger in, whatever it is told. It is taken out and each part
# signed again, the extension before the app that holds it.
held=$(mktemp -d)
trap 'rm -rf "$held"' EXIT
for part in "$app/Contents/PlugIns/"*.appex "$app"; do
  codesign -d --entitlements - --xml "$part" > "$held/entitlements.plist" 2>/dev/null
  /usr/libexec/PlistBuddy -c "Delete :com.apple.security.get-task-allow" "$held/entitlements.plist" > /dev/null 2>&1 || true
  codesign --force --options runtime --timestamp --entitlements "$held/entitlements.plist" --sign "$SIGN" "$part"
done
codesign --verify --deep --strict "$app"
echo "$app"

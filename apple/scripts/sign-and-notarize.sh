#!/bin/sh
# Signs a Mac .app with the team's Developer ID identity, notarizes it and
# staples the ticket.
#
#   sign-and-notarize.sh path/to/MyApp.app [entitlements.plist]
#
# Needs the notarization credential stored once as "{{NOTARY_PROFILE}}"
# (see docs/account-setup.md). Nested frameworks and helpers must already be signed.
set -eu

identity="Developer ID Application: {{TEAM_NAME}} ({{TEAM_ID}})"
profile="${NOTARY_PROFILE:-{{NOTARY_PROFILE}}}"

app=${1:?usage: sign-and-notarize.sh path/to/MyApp.app [entitlements.plist]}
ent=${2:-}
[ -d "$app" ] || { echo "not an app bundle: $app" >&2; exit 1; }

if [ -n "$ent" ]; then
  codesign --force --options runtime --timestamp --entitlements "$ent" --sign "$identity" "$app"
else
  codesign --force --options runtime --timestamp --sign "$identity" "$app"
fi
codesign --verify --deep --strict --verbose=2 "$app"

zip="${app%.app}.zip"
ditto -c -k --keepParent "$app" "$zip"
xcrun notarytool submit "$zip" --keychain-profile "$profile" --wait
xcrun stapler staple "$app"
spctl -a -vv "$app"
rm -f "$zip"
echo "done: $app"

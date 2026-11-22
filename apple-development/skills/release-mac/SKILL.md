---
name: release-mac
description: Ship a Mac app, command-line tool or installer outside the App Store, signed with the team's Developer ID and notarized by Apple.
---

# Mac release with Developer ID

Confirm with the owner before submitting to Apple: notarization sends the
build to an outside service.

## App bundle
```
xcodebuild -scheme <S> -configuration Release -archivePath build/<S>.xcarchive archive 2>&1 \
  | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)" | head -20
{{ENV_DIR}}/scripts/sign-and-notarize.sh \
  build/<S>.xcarchive/Products/Applications/<App>.app [entitlements.plist]
```
The script signs (hardened runtime, timestamp), notarizes with `--wait`,
staples and runs `spctl`. It blocks until Apple answers. Never poll
`notarytool info` or `history`.

## Command-line tool
```
codesign --force --options runtime --timestamp \
  --sign "Developer ID Application: {{TEAM_NAME}} ({{TEAM_ID}})" <binary>
ditto -c -k <binary> <binary>.zip
xcrun notarytool submit <binary>.zip --keychain-profile {{NOTARY_PROFILE}} --wait
```
A bare binary cannot be stapled.

## Installer package
```
productbuild --component <App>.app /Applications \
  --sign "Developer ID Installer: {{TEAM_NAME}} ({{TEAM_ID}})" <App>.pkg
xcrun notarytool submit <App>.pkg --keychain-profile {{NOTARY_PROFILE}} --wait
xcrun stapler staple <App>.pkg
```

## If it fails
- `Invalid` from notarytool: run `xcrun notarytool log <id> --keychain-profile
  {{NOTARY_PROFILE}}` once and fix every issue listed. Usual causes: a nested
  binary not signed, no hardened runtime, no secure timestamp, or the
  `get-task-allow` entitlement left in.
- No keychain profile: the owner stores it once (`{{ENV_DIR}}/docs/account-setup.md`). Do not ask for or handle the password.
- Sign nested frameworks, helpers and XPC services first, the app last. Do
  not use `--deep` to sign.

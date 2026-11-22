---
name: release-app-store
description: Archive an iOS, iPadOS, macOS, tvOS, watchOS or visionOS app and upload it to App Store Connect or TestFlight under the {{TEAM_NAME}} team.
---

# App Store and TestFlight release

Confirm with the owner before uploading. An upload is outward-facing and a
build number cannot be reused.

## Before archiving
- The app record exists in App Store Connect (Apps > +) with the same bundle
  identifier. Only the owner creates it.
- Xcode is signed in to the {{TEAM_NAME}} account (Settings > Accounts).
- Version (`MARKETING_VERSION`) and build (`CURRENT_PROJECT_VERSION`) are
  raised; the build number is higher than every earlier upload.

## Archive and upload
```
xcodebuild -scheme <S> -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/<S>.xcarchive -allowProvisioningUpdates archive 2>&1 \
  | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)" | head -20

xcodebuild -exportArchive -archivePath build/<S>.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates 2>&1 | grep -E "error:|EXPORT (SUCCEEDED|FAILED)" | head -20
```

`ExportOptions.plist`:
```
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>{{TEAM_ID}}</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
```
For macOS use `-destination 'generic/platform=macOS'`.

The export returns once when the upload finishes. Processing on Apple's side
takes minutes; report "uploaded" and stop. Do not poll App Store Connect.

If Xcode is not signed in, the upload fails with an authentication error:
tell the owner, or use Xcode > Product > Archive > Distribute App.

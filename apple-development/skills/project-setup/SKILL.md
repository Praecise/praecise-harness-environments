---
name: project-setup
description: Set up a new or existing Xcode project to build and sign under the {{TEAM_NAME}} team. Use once per app repository.
---

# Project setup ({{TEAM_NAME}})

Do each step once. Do not reread files you have already seen.

1. Find the project: `ls -d *.xcodeproj *.xcworkspace Package.swift 2>/dev/null`.
   If none exists, ask the owner to create it in Xcode (File > New > Project);
   do not hand-write a `.pbxproj`.
2. Add `Config/Signing.xcconfig` and set it as the base configuration of the
   app target for Debug and Release:

   ```
   DEVELOPMENT_TEAM = {{TEAM_ID}}
   CODE_SIGN_STYLE = Automatic
   PRODUCT_BUNDLE_IDENTIFIER = {{BUNDLE_PREFIX}}.<appname>
   ```

   For a Mac app shipped outside the App Store also add
   `ENABLE_HARDENED_RUNTIME = YES`.
3. Copy `templates/CLAUDE.md` from this plugin into the repository root as
   `CLAUDE.md` (merge if one exists) and fill in the scheme name.
4. Make sure `.gitignore` has: `build/`, `DerivedData/`, `*.xcuserstate`,
   `xcuserdata/`, `*.p12`, `*.p8`, `*.mobileprovision`, `*.provisionprofile`.
5. Verify with one build (see the build-test skill). Report the result.

Never commit a certificate, key or profile. Sign only as team `{{TEAM_ID}}`,
whatever other identities this Mac holds.

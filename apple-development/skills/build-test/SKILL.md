---
name: build-test
description: Build, test, preview and read diagnostics for an Xcode project with the least output. Use for every build or test run in an Apple app repository.
---

# Build and test

## Order of preference
1. **The `xcode` MCP server** when it is connected (Xcode open with the
   project, external agents allowed). Use its build, test, issue-list, preview
   and documentation-search tools. They return structured results; do not
   also fetch the full build log. Tool names as reported for Xcode 26.3+
   (trust the server's own list if it differs): `BuildProject`,
   `XcodeListNavigatorIssues`, `XcodeRefreshCodeIssuesInFile`, `GetTestList`,
   `RunSomeTests`, `RunAllTests`, `RenderPreview`, `ExecuteSnippet`,
   `DocumentationSearch`; `GetBuildLog` only when the issue list is not enough.
   **Xcode 27 and later** (tool names as its server lists them; trust the
   server's own list if it differs):
   - Open first. Every call is refused until the project has been opened
     through `XcodeOpenWorkspace` (or made with `XcodeNewProject`) and the
     owner has approved the agent once, from Xcode's Model Context Protocol
     menu bar item. Ask for that approval once; do not retry in a loop.
   - Calls take the `workspaceIdentifier` that `XcodeOpenWorkspace` returns,
     not a tab identifier. The identifier changes when the workspace is
     closed and opened again.
   - Choose what is built with `XcodeSwitchScheme` and
     `XcodeSwitchRunDestination` (`XcodeListSchemes`,
     `XcodeListRunDestinations` list them). After the project file changes on
     disk the workspace may report no schemes: close it with
     `XcodeCloseWorkspace`, open it again, then switch scheme.
   - `RunProject`, `StopProject` and `GetConsoleOutput` run the app and read
     what it prints. `GetConsoleOutput` takes a `pattern` and a `tailLimit`:
     always pass both.
   - `RenderPreview` returns the picture at `snapshot.path` and lists the
     destinations it can render on (`supportedOverrides.renderDestinations`),
     which may include a connected device. Pass
     `previewDefinitionIndexInFile` for any preview but the first.
   - Looking at a running app on a simulator or a device:
     `DeviceInteractionStartWorkspaceSession`,
     `DeviceInteractionInstallAndRun` (takes `commandLineArguments`),
     `DeviceInteractionSynthesize`, then `DeviceInteractionEndSession` when
     done. End every session you start.
   - Targets, entitlements, Info.plist keys and build settings have tools of
     their own (`XcodeNewTarget`, `AddEntitlement`, `AddInfoPlist`,
     `GetTargetBuildSettings`, `UpdateTargetBuildSetting`). Use them instead
     of editing `project.pbxproj`.
   - `DocumentationSearch` answers only when Xcode's documentation is
     installed; if it reports that it is not, read developer.apple.com.
2. **`xcodebuild`**, filtered, when the server is not connected. Say once that
   it is not connected; do not retry the connection.

## Shell commands (output always filtered)

```
xcodebuild -list 2>/dev/null | sed -n '/Schemes:/,$p'

xcodebuild -scheme <S> -destination 'platform=macOS' build 2>&1 \
  | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | sort -u | head -40

xcodebuild -scheme <S> -destination 'platform=iOS Simulator,name=<a simulator from xcrun simctl list devices available>' test 2>&1 \
  | grep -E "error:|failed|TEST (SUCCEEDED|FAILED)|Executed" | head -40
```

Add `warning:` to the pattern only when asked about warnings.

A multiplatform app that embeds a watch app builds for the Mac only when the
watch app's embedding and its target dependency are limited to iOS (a
platform filter on both). Without it the Mac build is refused.

A command-line build with `CODE_SIGNING_ALLOWED=NO` goes to its own
`-derivedDataPath`, never Xcode's: a product left half signed there breaks
Xcode's next signed build of the same target.

## Loop rules
- One build per round. Read all errors, fix all of them, then build again.
- Never rebuild to confirm an unchanged tree. Never rerun passing tests.
- Run the narrowest test first (`-only-testing:<Target>/<Class>/<test>`), the
  full suite once at the end.
- Builds run in the foreground and return once. No background build plus
  status checks.
- For a SwiftUI change, render the preview through the `xcode` server once
  rather than launching the app.

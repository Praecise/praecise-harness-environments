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
2. **`xcodebuild`**, filtered, when the server is not connected. Say once that
   it is not connected; do not retry the connection.

## Shell commands (output always filtered)

```
xcodebuild -list 2>/dev/null | sed -n '/Schemes:/,$p'

xcodebuild -scheme <S> -destination 'platform=macOS' build 2>&1 \
  | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | sort -u | head -40

xcodebuild -scheme <S> -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 \
  | grep -E "error:|failed|TEST (SUCCEEDED|FAILED)|Executed" | head -40
```

Add `warning:` to the pattern only when asked about warnings.

## Loop rules
- One build per round. Read all errors, fix all of them, then build again.
- Never rebuild to confirm an unchanged tree. Never rerun passing tests.
- Run the narrowest test first (`-only-testing:<Target>/<Class>/<test>`), the
  full suite once at the end.
- Builds run in the foreground and return once. No background build plus
  status checks.
- For a SwiftUI change, render the preview through the `xcode` server once
  rather than launching the app.

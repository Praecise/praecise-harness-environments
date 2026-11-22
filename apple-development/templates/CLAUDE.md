# Rules for Claude and every agent it starts

## HARD RULE: no rereads, no polling, no wasted tokens
Put these lines first in every agent brief.
- Never reread a file, log, page or tool output already in context. Read
  targeted (grep or a line range), once.
- Never poll. No status loops, no sleep-and-check. Start work so it writes one
  result, wait on the exit or notification, read it once.
- Keep command output small. Never dump a full `xcodebuild` log.
- Few, narrow agents. No agent for what a handful of tool calls can do.

## This app
- Scheme: `<SCHEME>`  Bundle ID: `{{BUNDLE_PREFIX}}.<appname>`
- Team: {{TEAM_NAME}}, `{{TEAM_ID}}`. Sign only as this team.
- Build and test: the `xcode` MCP server when connected, otherwise filtered
  `xcodebuild` (skill `apple-dev:build-test`). One build per round.
- Release: skills `apple-dev:release-mac`, `apple-dev:release-app-store`.
  Confirm with the owner before any upload or notarization.
- Signing trouble: skill `apple-dev:signing-doctor`.
- Never commit or write to disk a key, `.p12`, `.p8` or profile.

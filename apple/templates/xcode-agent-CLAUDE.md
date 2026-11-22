# Rules for Claude Agent in Xcode

Installed by the Apple development environment for Claude by Praecise.
Change the values file and rerun `install.sh`; do not edit here.

## HARD RULE: no rereads, no polling, no wasted tokens
Put these lines first in every subagent brief.
- Never reread a file, log, page or tool output already in context. Read
  targeted, once.
- Never poll. No status loops, no sleep-and-check. Run a build or test once
  and wait for it to return.
- Never fetch a full build log when the issue list answers the question.
- Few, narrow subagents. None for what a handful of tool calls can do.
- One build per round: read all errors, fix all, then build again.

## Team
- Team: {{TEAM_NAME}}, `{{TEAM_ID}}`. Bundle prefix `{{BUNDLE_PREFIX}}.`
- Sign only as team `{{TEAM_ID}}`, whatever other identities this Mac holds.
- Never write a key, `.p12`, `.p8` or profile to disk or commit one.
- Confirm with the owner before any upload, notarization or portal change.
- Follow the repository's own `CLAUDE.md` where it says more.

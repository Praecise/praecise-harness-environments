# Apple development environment for Claude by Praecise

Lets Claude build, test, sign and release Apple platform apps for your developer
team: in the terminal with Claude Code, inside Xcode with Claude Agent, and in a
praecise-harness app. One set of skills serves all three.

Needs a Mac, Xcode 26.3 or later and an Apple Developer Program team.

## What is in it

```
skills/
  project-setup       put a repository under your team
  build-test          build, test, previews and diagnostics with small output
  release-mac         Developer ID signing and notarization
  release-app-store   archive and upload to App Store Connect and TestFlight
  signing-doctor      signing, profile, keychain and expiry problems
agents/apple-builder  runs one build or test and returns only the errors
templates/            CLAUDE.md for an app repository and for Claude Agent in Xcode
scripts/              verify.sh, sign-and-notarize.sh
docs/account-setup.md certificates, Xcode settings and the notarization credential
index.ts              the praecise-harness plugin
install.sh            the installer for Claude Code and Xcode
FRONTIER.md           what is current in Claude for Apple development
```

It is kept small on purpose. Every installed skill adds its description to every
session, so there are five, and each starts from the same rules: never reread,
never poll, keep output small, one build per round.

## Your team's values

```
cp apple.env.example apple.env     # then fill in the five values
```

The skills hold placeholders such as `{{TEAM_ID}}`; the installer and the plugin
fill them in. `apple.env` is ignored by git.

## Claude Code and Xcode

```
./install.sh                       # or: ./install.sh path/to/apple.env
```

It writes a filled-in copy to `~/.praecise/environments/apple`, registers Xcode's
MCP bridge with Claude Code (`xcrun mcpbridge`), installs the copy as the plugin
`apple-dev`, and puts the rules, skills and agent in
`~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig`, the folder Xcode's
Claude Agent reads. Run it again after changing a value or a skill.

Then, in Xcode > Settings > Intelligence: install Claude Agent, and allow external
agents to use Xcode tools. `docs/account-setup.md` has the full list.

In Claude Code, inside an app repository: "set this project up for my team",
"build", "run the tests", "release the Mac app", "upload to TestFlight". In Xcode,
type `/` in the coding assistant to see the `apple-dev-*` skills.

Remove it with `claude plugin uninstall apple-dev@praecise`, `claude mcp remove
xcode`, and by deleting `~/.praecise/environments/apple` and the `apple-dev-*`
folders in the Xcode folder above.

## praecise-harness

```ts
// praecise.config.ts
import { defineConfig } from "@praecise/harness";
import { appleDevelopment } from "@praecise/harness-environments/apple-development";

export default defineConfig({
  plugins: [
    appleDevelopment({
      team: "ABCDE12345",
      teamName: "Example Ltd",
      bundlePrefix: "com.example",
      developmentIdentity: "Apple Development: Jane Doe (ABCDE12345)",
      notaryProfile: "example-notary",
    }),
  ],
});
```

The app gains the five skills, the tool `xcode` (Xcode's MCP bridge), the agent
`apple`, and a check of the machine. There is nothing to sign in to: the team's
signing identities live in this Mac's keychain and never leave it, and `connect`
finds them.

```
praecise apple-development connect     # find the team's identities on this Mac
praecise apple-development accounts    # the team and each identity found
praecise apple-development doctor      # what the machine is missing
praecise run apple "build the app and fix what fails"
praecise acp --agent apple      # as an agent an editor launches, Xcode included
```

## What it will not do

It does not create certificates, register devices, accept agreements or sign in
anywhere: those need the account owner. It asks before an upload or a
notarization, and it never writes a key or a profile to disk.

# Claude for Apple development: state of the frontier

Researched 22 Nov 2026. "Apple" and "Anthropic" items are from their own
pages. "Community" items come from third-party guides and are not verified
here; check each before relying on it.

## What changed the field

1. **Agents inside Xcode (Apple, Xcode 26.3, Feb 2026).** Xcode runs Claude
   Agent (built on the Claude Agent SDK) and Codex natively. The agent
   explores the whole project, plans, edits, builds, tests, searches Apple
   documentation and checks its own UI work by capturing SwiftUI previews.
   Subagents, background tasks and plug-ins work inside Xcode (Anthropic).
2. **Xcode as an MCP server (Apple).** `xcrun mcpbridge` exposes Xcode to any
   outside agent. This is what lets Claude Code in the terminal build, test,
   read live issues and render previews through the running Xcode instead of
   parsing `xcodebuild` logs. Community sources count about 20 tools
   (build, test list and run, navigator issues, per-file diagnostics, snippet
   execution, preview render, documentation and WWDC transcript search).
3. **Visual self-verification.** Preview capture closes the loop for UI: the
   agent sees what it built. This is the largest single quality gain for
   SwiftUI work and costs one image per check.
4. **Customizable agent environments (Apple).** Xcode's Claude Agent reads
   `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig` only, with
   its own model default, MCP servers and skills; Intelligence settings add
   per-command and per-tool permissions and a Plug-ins manager.
5. **Open agent slot (Apple).** Any agent that speaks the Agent Client
   Protocol can be added under Agents; any Chat Completions endpoint, hosted
   or local, can be added as a chat provider. A community source says Gemini
   arrived this way in Xcode 26.6 (unverified).

## What this environment already uses

Items 1, 2 and 4: the installer registers the MCP bridge, the skills prefer it
over shell builds, and the rules and skills are written into Xcode's own agent
config.

## Worth adding next, in order

| Step | Why | Cost / caution |
|---|---|---|
| Preview check in the build loop | Catches layout faults a build cannot | Already possible through the bridge; make it a habit per UI change, one render each |
| XcodeBuildMCP (github.com/getsentry/XcodeBuildMCP), per project | Simulator boot, install, launch, screenshots, taps and LLDB without Xcode open; suits headless and long runs | Community count is about 82 tools: a large tool list in every session. Add it per repository, not at user scope. Third party |
| Per-project config for scheme and destination | Removes the "which scheme" round trip every session | A few lines in the repository's `CLAUDE.md` (template provided) |
| Hook that filters `xcodebuild` output | Enforces small output even when a skill is not loaded | Small shell hook in Claude Code settings; needs testing |
| App Store Connect API key | Unattended TestFlight uploads and notarization, build status without the browser | Team-wide credential on disk; the owner's decision |
| Our own skills for the frameworks we ship on | Agents are weakest on APIs newer than their training; a short, dated skill per framework fixes that | Write only for frameworks in real use; date each and review at every Xcode release |

## Looked at and not adopted

- **Large community skill packs** (for example rshankras/claude-code-apple-skills,
  Axiom). Good reference when writing a skill. Installed whole, they add hundreds
  of descriptions to every session.
- **Driving Xcode's UI by scripting.** Replaced by the MCP bridge.

## Open questions

- Exact tool names and parameters of the bridge on the current Xcode: read them once
  from the server's tool list with Xcode open and correct `build-test`.
- Whether Xcode's Claude Agent picks up `skills/` and `agents/` from its
  config folder exactly as Claude Code does. Check with `/` in the assistant
  after installing Claude Agent.
- Whether the bridge can run against more than one open project at a time.

## Sources

- Apple: developer.apple.com/documentation/xcode/setting-up-coding-intelligence
- Apple: developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode
- Apple: developer.apple.com/documentation/xcode/extending-and-customizing-agents
- Apple: apple.com/newsroom/2026/02/xcode-26-point-3-unlocks-the-power-of-agentic-coding/
- Apple: developer.apple.com/videos/play/tech-talks/111428
- Anthropic: anthropic.com/news/apple-xcode-claude-agent-sdk
- Community: charleswiltgen.github.io/Axiom/reference/xcode-mcp-ref
- Community: blakecrosley.com/blog/xcode-mcp-claude-code
- Community: github.com/getsentry/XcodeBuildMCP
- Community: github.com/rshankras/claude-code-apple-skills

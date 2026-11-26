# Computer control for agents: state of the frontier

Researched 26 Nov 2026, for an environment that lets a harness agent use a Mac, a
Windows or a Linux machine the way Claude Code uses Chrome. "Anthropic", "Microsoft"
and "Apple" items are from their own pages. "Paper" items are from the paper named.
"Community" items are project READMEs and write-ups, not verified here.

## What "the way Claude Code uses Chrome" is

Claude's Chrome control is better than plain computer use for four reasons, and each
is a property we can reproduce on a desktop:

1. **Elements, not pixels.** The page is read as an accessibility tree in which every
   element has a reference (`link "Getting started" [ref_2]`), and a click names the
   reference. Coordinates remain as the fallback (Anthropic, `browser_toolset_20260801`).
2. **Reading is separate from looking.** `read_page` (filters `interactive` / `all`,
   `depth`, a subtree by `ref`, 50,000 character cap), `find` (20 matches) and
   `get_page_text` answer most questions without an image.
3. **The person's own session.** An extension plus a native messaging host drives the
   signed-in browser, with permission asked per site.
4. **Several actions in one turn**, run in order, stopped at the first failure.

Anthropic's desktop toolset (`computer_toolset_20260801`, 17 members) has only the
fourth. It is screenshots and coordinates; its page describes no element references.
Claude Code's own desktop control is macOS only in the CLI, takes the screen (other
apps are hidden, one session holds a lock), and tiers apps: view only for browsers,
click only for terminals and IDEs, full for the rest.

## What the harness has today

`computer(screen)` over a `Screen` (screenshot, click, drag, scroll, type, key, zoom,
wait, batch halt), sent as an endpoint's native computer tool where it names one.
`browserScreen` is the one screen that ships: a headless Chromium on its own profile,
driven over the DevTools protocol by coordinates. The call is `effect: "write"` and
its output is untrusted.

Missing: any element channel (read, find, references), any desktop driver, apps and
windows as things an agent can name, the browser toolset as a native tool, and the
person's signed-in browser.

## Findings

**1. Three channels on one machine beat pixels (paper: Hybrid Computer Use, Microsoft
Research, arXiv 2610.41432, 30 Oct 2026).** Programmatic (shell, files), semantic
(accessibility tree with references) and visual (screenshot and pointer), chosen by
the model with no separate planner. Against a screenshot driver on OSWorld 2.0 with
the same model: partial score 72.4 against 68.8, tool calls 78 against 112, input
tokens 0.94M against 2.18M. On OSWorld 1.0, removing the visual channel changed the
score within run-to-run variation (66.1 against 65.6); removing the semantic channel
cost about 3 points and 5 steps. The element channel carries the work and vision is
the fallback. Gains differ by model; Claude's step counts barely moved.

**2. The details that make references safe (same paper).** A reference is resolved
against the live element before each action and a replaced or ambiguous one fails
(`stale_ref`) and is never redirected. Coordinate input is refused if the window
layout changed since the last screenshot. Each action returns its effect and a diff
of the tree, so a screenshot is only taken when asked for. Up to 64 actions per call.

**3. Working without taking the person's pointer is possible on all three, by
different means.**

| | Read elements | Act on elements | Pointer and keys | See | Out of the person's way |
|---|---|---|---|---|---|
| macOS | AXUIElement | AX actions (`AXPress`, set value) | CGEvent posted to one process; app dependent | ScreenCaptureKit, one window | A second user session is the robust route (community: backseat). Virtual displays and SkyLight are private API. |
| Windows | UI Automation | UIA patterns (Invoke, Value, Toggle, ExpandCollapse) need no focus | SendInput (takes the foreground) | Windows.Graphics.Capture, one window | A separate session under its own account. Microsoft's Agent Workspace is this, in private preview, off by default. |
| Linux | AT-SPI | AT-SPI actions | RemoteDesktop portal and libei on Wayland; XTEST reaches only XWayland windows | ScreenCast portal over PipeWire | A second headless session (community, GNOME). KDE, GNOME and COSMIC each differ. |

Apple publishes no agent API for the whole system; App Intents and Xcode's MCP tools
are what is public, and reports of system-wide MCP in macOS 27 conflict. OpenAI's
Codex (16 Apr 2026) is the shipped proof of background control with a separate cursor
and several agents at once on macOS.

**4. Pixel control is unsafe as it stands (papers: RedTeamCUA, OS-Harm, MirrorGuard).**
Injected instructions succeeded 42.9% of the time against one Claude computer-use
agent and 7.6% against the most resistant agent tested. Adding the accessibility tree
to screenshots cut that substantially. A check on each proposed action took one agent
from 30.0% to 1.8% on OS-Harm. Adaptive attacks do better than fixed benchmarks, so
these are lower bounds. Anthropic's advice is a dedicated machine or container, no
credentials, an allowlist and a person confirming consequential actions.

**5. Scores are saturating on the old benchmark and not on the new one.** OSWorld-
Verified leaders are reported at 86 to 90% against a human 72.4%; trackers disagree
on the order. OSWorld 2.0 (long tasks) is near 20 to 35% binary completion.

## What follows for us

The opening is the one nobody has shipped as a product: the browser toolset's element
model on the desktop, on three systems, behind one contract, with a guard that knows
what is being pressed. A pixel click cannot be classified. An action on a button
whose role and name are known can.

**In the harness (general, so both benefit):**

- Extend `Screen` with optional `read`, `find` and `act` on a reference, a target that
  is a reference or a point, `stale` failures, a diff with each action, and
  `apps` / `windows`. A screen without them stays complete, as today.
- Send it as an endpoint's native browser toolset where the endpoint names one, as
  `computer` is today, and as ordinary functions everywhere else.
- Give `browserScreen` the element channel through the DevTools accessibility domain.
  This is the smallest step and is testable now.
- Refuse coordinate input after a layout change.

**In this repository, one environment:**

- Apps are the accounts. `discover` lists them, each starts in `read` (see only),
  `draft` allows typing and navigating, `act` allows what commits. This is Claude
  Code's three tiers, held by the guard that already exists.
- Each element action is given one of the six kinds from its role and name (a Send
  button sends, a Delete item destroys, a Pay button spends), and anything unclear
  publishes, which needs a person. What is read from a screen taints what follows.
- The sign-in is `local`: the system permissions found, not granted by us. `doctor`
  lists what is missing (Accessibility and Screen Recording on a Mac, the portal on
  Linux, the session on Windows).
- One small native helper per system speaking one protocol, signed. A Mac's
  permissions attach to the signature, and Windows lets only a signed, installed
  program drive elevated windows.
- A second session as the unattended mode on each system, and the person's own
  session as the attended one.
- The signed-in browser through an extension and native messaging. Chrome no longer
  opens the debugging port on a default profile.

## Order, and where it stands

| Step | State | Caution |
|---|---|---|
| 1. Element channel in `Screen` and `browserScreen` | Built in the harness as `elements(screen)`: read, find, text, click, hover, fill, scroll to, what changed after each action, stale references refused. Checked against a real Chromium | An endpoint's own browser toolset is not declared natively yet; it also wants tabs |
| 2. This environment | Built against a stand-in helper: apps as accounts, the three modes, each press classified, the protocol in PROTOCOL.md | The words that classify a press are English |
| 3. macOS helper | Written. Tried against TextEdit behind another app: reading, filling, pressing, typing, single keys, a picture and a zoom work and nothing comes to the front. A Command chord and an Edit-menu command do nothing in an app that is not in front | Not signed. Work that needs such commands wants a second user session |
| 4. Linux helper | Written. Tried through the whole environment against a GTK app in a session of its own: reading, modes, filling, pressing, stale references, a picture, pointer, typing and chords | Wayland has no picture or pointer yet (portals); pointer on X11 only with `--own-session` |
| 5. Windows helper | Written. 28 checks against a Windows Forms app in the signed-in session: reading, filling, pressing, stale references, a picture behind other windows, posted clicks and typing | Chords are refused; must run in the signed-in session; Store apps in a shared frame are not listed |
| 6. Browser extension | Written for Chrome and other Chromium browsers as Praecise Control: one offered tab on one site, a short list of commands, cut off when it leaves the site or is stopped. Tried in a real Chromium | Loaded unpacked; not in a store. Safari and Firefox have no debugger to rest on and need another design |
| 7. Measure | Not started | OSWorld 2.0, Windows Agent Arena, MacAgentBench for work; RedTeamCUA and OS-Harm for safety; same model with and without the element channel. A skip is not a pass |

Not built from the list above: refusing coordinate input after a window's layout
changes. A window that changes size is treated as a new screen, which covers resizing
and nothing else.

## Praecise Control, as a product (owner, 26 Nov 2026)

What was decided: the helpers and extensions ship as one product named Praecise
Control. On each system it is an app a person can see, in the menu bar or the taskbar,
that says what an agent is using and stops it. There is an extension of our own for
Chrome, Safari and Firefox. Each follows the rules of the place it is distributed. It
keeps nothing that grows without bound. An agent can do what a person can: press,
fill, type, drag, scroll.

What the helpers and the extension already do toward that: every action above is
there; nothing is written to disk by any of them, so there is no cache; an agent sees
only the apps named and the one tab offered.

What the research says about distribution, and how sure it is:

| Where | Finding | Source |
|---|---|---|
| Mac App Store | A sandboxed app cannot rely on controlling other apps through the Accessibility API. Apple's own engineers point such apps to Developer ID signing and notarization outside the store | Apple Developer Forums replies; the guideline text itself was not read |
| Chrome Web Store | The narrowest permissions that do the job, each one justified; powerful permissions and new developers are reviewed longer. Policy changes on data collection are enforced from 1 Aug 2026 | Chrome's program policies and its 2026 policy post; nothing found that names the debugger permission |
| Firefox | No debugger API for extensions. Firefox has dropped the DevTools protocol for WebDriver BiDi | Third-party write-ups; Mozilla's own pages not read |
| Safari | An extension ships inside a Mac app. No debugger API | Not confirmed from Apple's pages in this pass |
| Microsoft Store | Desktop apps are packaged as MSIX and signed by the store. Nothing found on driving other apps' windows | Microsoft Learn; the policy text was not read for this |

What follows, not yet built:

1. The Mac app: a menu bar app, Developer ID signed and notarized, outside the Mac App
   Store, that holds the two permissions under its own name and carries the helper.
2. The Windows app: a tray app in the signed-in session, which is also what removes
   the need to start the helper there by hand.
3. The Linux app: a tray item where the desktop has one.
4. Safari and Firefox extensions on a different footing from Chrome's: reading the page
   from a content script and acting through it, which is weaker than the browser's own
   input and has to be measured before it is offered.
5. Store listings, each with the permission justifications and a privacy statement.

Before any of these is submitted, read the store's current policy text itself. The
table above is not enough to submit on.

## Not confirmed

- Current leaderboard order, and Agent Workspace's status after its preview notes.
- How Claude's extension keeps references (community sources only).
- Which Mac apps ignore events posted to a process; to be measured per app.
- The paper's per-system API list and several figures were read from a truncated
  page; check the PDF before quoting.

## Sources

- https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- https://code.claude.com/docs/en/computer-use and https://code.claude.com/docs/en/chrome
- https://arxiv.org/abs/2610.41432 (Hybrid Computer Use)
- https://arxiv.org/abs/2505.21936 (RedTeamCUA), https://arxiv.org/abs/2506.14866 (OS-Harm), https://arxiv.org/abs/2601.12822 (MirrorGuard), https://arxiv.org/abs/2506.16042 (OSWorld-Human)
- https://support.microsoft.com/en-us/windows/ai/ai-features/experimental-agentic-features
- https://developer.apple.com/wwdc26/guides/macos/
- https://openai.com/index/codex-for-almost-everything/
- https://yutori.com/leaderboards/osworld-verified
- Community: github.com/akshithio/backseat, github.com/minghinmatthewlam/computer-use-mcp, github.com/Kasempiternal/agentcontroller, github.com/Virtual0ps/computer-use-linux, github.com/zavora-ai/computer-use-mcp/pull/49

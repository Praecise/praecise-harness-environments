# Computer control

Working the apps on a Mac, a Windows or a Linux machine, the way a browser is worked
through its accessibility tree: each window is read as the things in it, each with a
reference, and pressed and filled by reference. A picture and a pointer are there for
what the list does not say.

Not released. See [What is not done](#what-is-not-done).

## What it gives an agent

| Function | What it does |
|---|---|
| `computer_control_accounts` | The apps it may use, each with a name and a mode. |
| `computer_control_elements` | Read a window as elements, find by words, and click, hover, fill and scroll to an element by reference. Each answer says what appeared, went or changed. |
| `computer_control_screen` | A screenshot of the window, zoom, and a pointer and keys by position. |
| `computer_control_open` | Start an app or bring up its window. |
| `computer_control_record` | Record a window as video, and take pictures from a recording. macOS, and Linux on X11. |

One skill, `use-an-app`, and one agent, `app-operator`.

## Use it

```ts
import { defineConfig } from "@praecise/harness";
import { computerControl } from "@praecise/harness-environments/computer-control";

export default defineConfig({
  plugins: [computerControl({ apps: ["TextEdit", "Numbers"] })],
});
```

```sh
praecise computer-control doctor     # the helper, its permissions, the apps named
praecise computer-control connect    # find the machine
praecise computer-control sync       # list the apps
praecise computer-control mode numbers draft
```

Only the apps named in `apps` are listed, read or opened. Nothing else on the machine
is.

## What may happen to an app

Each app is an account and starts in `read`.

| Mode | What an agent may do |
|---|---|
| `read` | Read the window's elements and text, and take screenshots. |
| `draft` | Also type into fields, move between tabs and links, press what only moves about (Next, Back, Cancel, Search), scroll, and open the app. |
| `act` | Also press what commits. Each such press waits for a person unless waived for that app. |

What a press is comes from what is pressed:

| Pressed | Taken as | Needs |
|---|---|---|
| A field, whatever it is called | `draft` | `draft` |
| A name that removes: Delete, Remove, Erase, Empty, Reset | `destroy` | `act`, and always a person |
| A name that pays: Pay, Buy, Checkout, Subscribe | `spend` | `act`, an `amount`, the app's limits, and a person above them |
| A name that sends: Send, Reply, Post, Submit, Share | `send` | `act`, and a person unless waived |
| A tab, link, row or option with no such name | `draft` | `draft` |
| A button or menu item that only moves about | `draft` | `draft` |
| Anything else, anything unnamed, a reference never read | `publish` | `act`, and a person unless waived |
| A click or drag at a position | `publish` | `act`, and a person unless waived |
| Return, or any chord but shift | `publish` | `act`, and a person unless waived |
| A character, an arrow, Tab, Escape, Backspace | `draft` | `draft` |

Once a window has been read in a conversation, what it showed is treated as written
by someone else: sending, paying, removing and anything not known to be harmless all
wait for a person, whatever the app waives.

The words are English. An app in another language has its commit buttons taken as
`publish`, which still needs a person, but removing and paying are not told apart
from it.

## Praecise Control

The machine is reached through Praecise Control, one small program per system. It is
an app a person can see, in the menu bar on a Mac and in the corner of the taskbar on
Windows and Linux. Its menu says which app an agent is using, pauses and resumes it,
and quits it. While it is paused every request is refused.

A harness does not start the app. It starts a relay, which passes what it is asked to
the app and the app's answers back:

```ts
computerControl({
  apps: ["TextEdit", "Numbers"],
  helper: ["/Applications/Praecise Control.app/Contents/MacOS/praecise-control", "connect"],
});
```

| | The app | The relay a harness starts |
|---|---|---|
| macOS | `Praecise Control.app`, built by `helpers/macos/build-app.sh` | `Praecise Control.app/Contents/MacOS/praecise-control connect` |
| Windows | `praecise-control.exe`, built by `helpers\\windows\\build.cmd` | `praecise-computer-helper.exe connect` |
| Linux | `helpers/linux/praecise-computer-helper --app` | `praecise-computer-helper connect` |

The app answers on a socket or pipe that only the signed-in person's programs can
open. On a Mac and on Linux the relay starts the app if it is not running. On Windows
the app has to be running in the signed-in session already, which its "Start when I
sign in" menu item arranges; a relay started over SSH or by a service then reaches it.

It keeps nothing on disk but that socket. Pictures are made when asked for and handed
back; none is stored.

[PROTOCOL.md](PROTOCOL.md) is what a helper answers. Each program also still runs by
itself, answering on its own input and output, which is what `praecise-computer-helper`
with no arguments does.

Each helper was tried against a small real app with a field, a button that saves and
then goes, a line of text and a checkbox (`tests/fixtures`), and what each can and
cannot do is below.

| | macOS | Linux | Windows |
|---|---|---|---|
| Read a window as elements | Accessibility API | AT-SPI, on X11 and Wayland | UI Automation |
| Press and fill by reference, without the pointer | yes | yes | yes |
| Picture of a window | ScreenCaptureKit | X11 only | PrintWindow, also behind another window |
| Pointer and keys by position | posted to the app's process | X11, and only in a session of the helper's own | posted to the window under the position |
| Chords | not acted on by an app that is not in front | yes, in its own session | refused, except shift with a character |
| Menus | listed beside the window, read by reference | in the window | in the window |

### macOS

[helpers/macos](helpers/macos/) is one Swift file, for macOS 14 and later.

```sh
SIGN="Developer ID Application: Name (TEAM)" NOTARY_PROFILE=profile \\
  computer-control/helpers/macos/build-app.sh /Applications
```

It builds for both kinds of Mac, in Swift 6, with one compiler job each at the lowest
priority. It
is distributed outside the Mac App Store, signed with a Developer ID and notarized: an
app that works other apps through the Accessibility API cannot be sandboxed. It needs
Accessibility and Screen Recording, which the person allows from its menu. They are
granted to the signed app under its own name, so they survive an update. `doctor`
says which is missing.

Tried against TextEdit kept behind another app: reading, filling, pressing a button,
typing, single keys, a picture and a zoom all worked, and nothing was brought to the
front. What did not: a Command chord, and Select All pressed in the Edit menu by
reference. Both act on whatever has the keyboard, and an app that is not in front has
nothing that does. Replace what a field holds with `fill`. Where a piece of work needs
such commands, run the apps in a second user session that is the agent's own.

### Linux

[helpers/linux](helpers/linux/) is one Python file. It needs `python3-gi` and
`gir1.2-atspi-2.0`, and `gir1.2-gtk-3.0` for pictures and held keys on X11. It has to be
started inside the desktop session, where the accessibility bus is.

Elements, pressing and filling work the same on X11 and Wayland. A pointer and keys by
position on X11 can only be the one pointer and keyboard the session has, so they are
refused unless the helper is started with `--own-session`, which says no person is
working in that session. On Wayland they need the RemoteDesktop portal, and a picture
needs the ScreenCast portal; neither is used yet, and both are refused there.

Tried in a session of its own (Xvfb, a GTK 3 app) through the whole environment, with
`tests/computer-control-real.test.ts`.

### Windows

[helpers/windows](helpers/windows/) is one C# file, built with the compiler that is part
of Windows. Nothing is installed.

```
computer-control\helpers\windows\build.cmd C:\tools\praecise-computer-helper.exe
```

The app has to run in the session of whoever is signed in. A helper started by itself
over SSH or by a service can see no window, and says so; started with `connect` it
reaches the app that can. No request can hold the app: one an app does not answer in
twenty seconds is given up on and said to be. Only apps with a window of their own are listed;
an app from the Store that is shown inside another process's frame is not.

Tried against a Windows Forms app in the signed-in session with
`tests/fixtures/windows-check.ps1`: 28 checks.

## Recording

`computer_control_record` records one app's window as video and gives back pictures
taken from a recording, spread evenly through it. Watching is reading: it needs no more
than the app being listed.

Recordings stay on the machine, in one folder of the helper's own that only the person
can open. They are kept for a day and within a size limit (2 GB unless
`PRAECISE_CONTROL_RECORDINGS_BYTES` says otherwise), the oldest removed first, and a
recording stops by itself at the length it was started with, at most ten minutes.

| | Recording |
|---|---|
| Linux | X11, through FFmpeg, which has to be installed. Sound from the machine with `audio: true`. Tried through the whole environment: start, a second start refused, stop, three pictures. Sound was not tried |
| macOS | ScreenCaptureKit, written by the system's own encoder; nothing to install. Sound from the app with `audio: true`. Tried against a window: start, a second start refused, stop, three pictures. Sound was not tried, and it was not tried through the environment |
| Windows | Not written. Windows' own capture is not reachable from the compiler that is part of Windows, and FFmpeg is not something to ask every person to install |

## The browser a person is signed in to

[browser/extension](browser/extension/) is the Praecise Control extension for Chrome and
other Chromium browsers. A person opens it, sees the web pages they have open, and
presses "Use this tab" beside one. The browser shows its own bar saying the tab is being
debugged for as long as that lasts.

```ts
import { elements } from "@praecise/harness";
import { signedInBrowser } from "@praecise/harness-environments/computer-control/browser";

const screen = await signedInBrowser();   // waits for a tab to be offered
export default elements(screen);
```

What holds it:

- **One tab, one site.** The offer is for the site the tab is on. The agent cannot take
  it to another site, and it is cut off if the tab goes to one, is closed, or the
  person presses Stop.
- **A short list of commands.** A picture, the page as a screen reader is told of it,
  the pointer, keys, and an address on the same site. The extension refuses anything
  else: nothing is evaluated in the page, and nothing is asked about cookies, storage
  or the network.
- **This machine only.** The extension connects to 127.0.0.1, and the listening side
  accepts only this extension.

Tried in a real Chromium with `tests/browser-real.test.ts`: offered from the
extension's own popup, read, filled, pressed, pictured, refused another site, and cut
off when stopped. Each step took well under a second.

It is loaded unpacked for now (chrome://extensions, Developer mode, Load unpacked).

### Firefox and Safari

[browser/extension-page](browser/extension-page/) is Praecise Control for the browsers
that give an extension no debugger. It asks for nothing in advance: opening it on a tab
and pressing "Use this tab" is what lets it into that tab, on that site. It reads the
page from inside it, as a screen reader would be told of it, and acts with the events a
page script can make. `signedInBrowser()` is the same call.

What differs from Chrome:

- A click, a filled field and a chosen option do what a person's would. A key does
  not, so the keys with an obvious meaning are carried out by hand (Return submits a
  form or presses what has the focus, Tab moves on, Backspace deletes, select all
  selects), and any other chord is refused.
- A drag is refused.
- A picture needs the tab to be the one in front in its window.
- What a password field holds is never read.
- It reads into a component's own tree where the page leaves that open.

Tried in a real Firefox 158 through geckodriver (`tests/firefox-real.test.ts`) and in a
real Chromium (`tests/browser-page-real.test.ts`).

## From Claude Code, Codex and other clients

`mcp.mjs` serves Praecise Control to a client that speaks MCP. The client is given the
apps as tools: `computer_control_accounts`, `computer_control_elements`,
`computer_control_screen` and `computer_control_open`. A screenshot arrives as an image.
Everything is still held to each app's mode.

Set it up once, in a folder of its own:

```sh
cp -r node_modules/@praecise/harness-environments/computer-control/app praecise-control && cd praecise-control
npm install
export PRAECISE_CONTROL_APPS="TextEdit,Numbers"
npx praecise computer-control doctor
npx praecise computer-control connect && npx praecise computer-control sync
npx praecise computer-control mode textedit draft
```

Then tell the client to start `node <folder>/node_modules/@praecise/harness-environments/computer-control/mcp.mjs <folder>`,
with `PRAECISE_CONTROL_APPS` in its environment. Each client's own way of saying that,
from its documentation as read on 26 Nov 2026:

| Client | How |
|---|---|
| Claude Code | `claude mcp add --env PRAECISE_CONTROL_APPS=TextEdit,Numbers praecise-control -- node <path>/mcp.mjs <folder>`. Tried with 2.1.323 and 2.1.332: connected |
| Codex | `codex mcp add praecise-control --env PRAECISE_CONTROL_APPS=TextEdit,Numbers -- node <path>/mcp.mjs <folder>`, or `[mcp_servers.praecise-control]` with `command`, `args` and an `env` table in `~/.codex/config.toml`. Not tried |
| Cursor | `.cursor/mcp.json` or `~/.cursor/mcp.json`: `{"mcpServers":{"praecise-control":{"command":"node","args":["<path>/mcp.mjs","<folder>"],"env":{"PRAECISE_CONTROL_APPS":"TextEdit,Numbers"}}}}`. Not tried |
| VS Code | "MCP: Add Server" in the Command Palette, then "Command (stdio)". Not tried |
| Gemini CLI | `gemini mcp add -e PRAECISE_CONTROL_APPS=TextEdit,Numbers praecise-control node <path>/mcp.mjs <folder>`, or the same `mcpServers` shape in `~/.gemini/settings.json`. Not tried |

Why there is a file for this at all: praecise-harness speaks the current revision of
MCP (2026-07-28) and no earlier one, and these clients still open with the earlier
handshake. Claude Code 2.1.332, the latest on the day, was refused by `praecise mcp`
and connected through `mcp.mjs`. `mcp.mjs` answers the handshake and passes each
request to the app unchanged; the harness is as it was.

A press that needs a person is refused over MCP with a line saying so. The harness does
not take an approval over MCP, on purpose: a message from a client must not be what
approves something. Where the client itself asks its person before each tool call, an
app's sending and publishing can be waived for that app, by a person:

```sh
npx praecise computer-control waive textedit publish send
npx praecise computer-control waive textedit none
```

Removing and paying cannot be waived, and once a window has been read in a conversation
everything that commits waits for a person whatever is waived. `waive` needs a harness
later than 1.2.1.

## What is not done

- **The Mac app is signed and not notarized.** Notarizing needs a credential stored on
  the Mac that builds it. The Windows app is not signed and has no icon of its own.
  Nothing has an installer.
- **The Linux icon was not seen.** It was tried where there is no panel to show it in.
- **Wayland** has elements, pressing and filling, and no picture or pointer.
- **Each helper was tried against one small app.** Which real apps ignore posted events,
  or describe themselves poorly to assistive technology, is not known.
- **On a Mac the environment was not run end to end**, only the app and its relay. On
  Windows and Linux it was, through each app.
- **It needs a harness later than 1.2.1**, for `elements()` and for an action whose
  kind depends on the call. Both are on the harness's main branch and not on npm.
- **The Safari app is built and signed, and has not been run in Safari.** Its project is
  in `browser/safari`, made by Apple's converter from `browser/extension-page`, and
  `browser/safari/build.sh` builds it. Turning it on in Safari is a person's to do.
- **The Firefox and Safari extension's own button was not pressed.** It was tried in a
  real Firefox and a real Chromium with the extension let into every page in advance;
  the press that lets it into one tab cannot be made by a test.
- **No extension is in a store.**
- **It has not been measured.** The benchmarks to run are listed in FRONTIER.md.

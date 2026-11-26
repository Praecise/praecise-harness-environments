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

## The helper

The machine is reached through a helper, one small program per system, which the
environment starts and speaks to in lines of JSON. [PROTOCOL.md](PROTOCOL.md) is what
a helper answers. `helper` names the command; `praecise-computer-helper` on the path
is used otherwise.

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
computer-control/helpers/macos/build.sh ~/.local/bin/praecise-computer-helper
```

It builds with one compiler job at the lowest priority, in about ten seconds. It needs
Accessibility and Screen Recording, which macOS asks of the program that starts it: the
terminal, or the app the harness runs in. `doctor` says which is missing.

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

It has to run in the session of whoever is signed in: one started by a service or over
SSH can see no window, and says so. Only apps with a window of their own are listed;
an app from the Store that is shown inside another process's frame is not.

Tried against a Windows Forms app in the signed-in session with
`tests/fixtures/windows-check.ps1`: 28 checks.

## What is not done

- **No helper is signed or packaged.** Each is built from its one file where it is used.
- **Wayland** has elements, pressing and filling, and no picture or pointer.
- **Each helper was tried against one small app.** Which real apps ignore posted events,
  or describe themselves poorly to assistive technology, is not known.
- **The Windows helper was tried by itself**, not through the environment, because the
  environment's test starts the helper and a helper started over SSH sees no window.
- **It needs a harness later than 1.2.1**, for `elements()` and for an action whose
  kind depends on the call. Both are on the harness's main branch and not on npm.
- **The person's signed-in browser.** A page in the browser the harness starts is read
  the same way today, through `elements(browserScreen(...))`. The browser a person is
  signed in to needs an extension, which is not written.
- **It has not been measured.** The benchmarks to run are listed in FRONTIER.md.

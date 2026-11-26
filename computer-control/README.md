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

## What is not done

- **No helper is in this repository yet.** The environment is tested against a
  stand-in. The three to write, and what each rests on, are in
  [FRONTIER.md](FRONTIER.md): macOS (Accessibility and ScreenCaptureKit), Linux
  (AT-SPI, and the RemoteDesktop portal on Wayland) and Windows (UI Automation).
- **It needs a harness later than 1.2.1**, for `elements()` and for an action whose
  kind depends on the call. Both are on the harness's main branch and not on npm.
- **The person's signed-in browser.** A page in the browser the harness starts is read
  the same way today, through `elements(browserScreen(...))`. The browser a person is
  signed in to needs an extension, which is not written.
- **It has not been measured.** The benchmarks to run are listed in FRONTIER.md.

# What a helper answers

A helper is a small program for one system. It is started once and spoken to in lines
of JSON on its standard input, and answers on its standard output, one line each:

```
{"id": 1, "method": "read", "params": {"app": "com.example.mail", "filter": "interactive"}}
{"id": 1, "result": [...]}
{"id": 2, "error": "e7 is no longer in the window; read it again"}
```

Anything it has to say that is not an answer goes to standard error.

## Rules

- **One window.** Every method but `hello` and `apps` takes `app`, the id `apps` gave.
  It works that app's main window and nothing else.
- **Window pixels.** Every position and box is in the pixels of what `screenshot`
  returns for that window, from its top left. The helper does any scaling, both ways.
- **Roles in one vocabulary.** `role` is the lower-case ARIA name where there is one:
  `button`, `link`, `textbox`, `searchbox`, `combobox`, `checkbox`, `radio`, `switch`,
  `slider`, `tab`, `menuitem`, `option`, `listitem`, `row`, `cell`, `heading`, `text`,
  `image`, `window`. The environment decides what a press is from the role and name, so
  a helper that passes the system's own role names through weakens the guard.
- **A reference is one thing.** `ref` names the same element for as long as it is
  there. `locate` and every method that takes a `ref` look the element up as it is now
  and answer with an error if it has gone, is hidden, or has a different role or name
  than when it was read. A reference is never taken to mean whatever is in its place.
- **Menus that are not in the window** are listed beside it in a full `read` as one
  `menubar` holding a `menuitem` for each, by name only. `read` with one's `ref` gives
  what is in it. They are pressed, never pointed at: `locate` puts them outside the
  window.
- **Leave out the layout.** Unnamed containers are left out and what is in them kept.
- **Refuse, do not fall back.** A method the system cannot perform for this app is an
  error that says so. A helper does not quietly do it another way that takes the
  person's pointer or brings a window to the front.

## Methods

| Method | Params | Result |
|---|---|---|
| `hello` | | `{ system, user, host, can, needs }`. `system` is `macos`, `windows` or `linux`. `can` lists which of `activate`, `fill`, `press`, `release`, `hold` it has. `needs` is `[{ name, ok, fix }]`: what it needs from the system and whether it has it. |
| `apps` | | `[{ id, name }]`: what is installed or running. The environment shows an agent only the ones it was told of. |
| `open` | `app` | Start the app, or bring up its window. |
| `window` | `app` | `{ width, height, title }` of its main window, in screenshot pixels. An error if it has none. |
| `screenshot` | `app`, `region?` | `{ mime, data }`, base64. With `region` (`{ x, y, width, height }`), that part enlarged. |
| `read` | `app`, `filter?`, `depth?`, `ref?` | Elements: `{ ref, role, name?, value?, states?, box?, children? }`. `filter: "interactive"` is a flat list of what can be pressed or typed into. `ref` reads one element and what is in it. |
| `locate` | `app`, `ref` | The element as it is now, brought into view, with `box`. |
| `activate` | `app`, `ref` | Press the element without the pointer. |
| `fill` | `app`, `ref`, `value` | Replace what a field holds. |
| `click` | `app`, `at`, `button`, `count`, `modifiers` | |
| `move` | `app`, `to` | |
| `drag` | `app`, `from`, `to`, `modifiers` | |
| `scroll` | `app`, `at`, `by` (`{ dx, dy }` in clicks of the wheel), `modifiers` | |
| `type` | `app`, `text` | |
| `key` | `app`, `combo` (`"Return"`, `"ctrl+s"`) | |
| `cursor` | `app` | `{ x, y }` |
| `press`, `release` | `app`, `button` | Hold a button down, and let it go. |
| `hold` | `app`, `combo`, `seconds` | |

A helper that lists `record` in `can` also answers:

| Method | Params | Result |
|---|---|---|
| `record_start` | `app`, `seconds?` (the longest it may run), `audio?`, `fps?` | `{ recording, seconds, width, height }`. One recording per app at a time. |
| `record_stop` | `recording` | `{ recording, path, mime, bytes, seconds }`. The file stays on the machine. Asked again of one that has ended, it says where the file is. |
| `frames` | `recording`, `count?` | `{ recording, seconds, frames: [{ mime, data, name, at }] }`: pictures spread evenly through it. |

Recordings are kept in one folder of the helper's own, for a day and within a size
limit, the oldest removed first. A helper that cannot keep within that refuses to start.

What a person sees in the app's menu, a helper also answers, for a program at their own
terminal. The environment does not offer these to an agent.

| Method | Params | Result |
|---|---|---|
| `storage` | | `{ folder, bytes, limit, elements, recordings: [{ name, bytes, at }] }`: what is kept on disk, and how many things are remembered from windows. |
| `sessions` | | `[{ since, app, last }]`: the programs connected to the app now, with the app each last asked about. |
| `clear` | `what`: `recordings` or `cache` | `{ removed }`. A recording that is still running is left. |

`states` are words from: `disabled`, `focused`, `checked`, `partly checked`, `pressed`,
`expanded`, `collapsed`, `selected`, `required`, `invalid`.

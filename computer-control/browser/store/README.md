# Publishing the browser extensions

What each store is given, word for word, so that a listing can be filled in without
writing anything new. One file per store, the packages made by `package.sh`, and the
pictures in `images/`.

| Store | Package | Listing | Who installs from it |
|---|---|---|---|
| Chrome Web Store | `out/chrome.zip` | [chrome.md](chrome.md) | Chrome, and other Chromium browsers that use it |
| Microsoft Edge Add-ons | `out/chrome.zip` | [edge.md](edge.md) | Edge |
| addons.mozilla.org | `out/firefox.zip`, `out/source.zip` | [firefox.md](firefox.md) | Firefox |
| Mac App Store | the app in `../safari` | [safari.md](safari.md) | Safari |

```sh
sh package.sh        # makes out/chrome.zip, out/firefox.zip, out/source.zip
```

## What the extension is, in one place

Every store asks the same things in different boxes. These are the answers.

- **Name:** Praecise Control
- **Short description:** Lets an AI agent on your own computer use one tab you offer it, on the site it is on, until you stop it.
- **Single purpose:** Let a person offer one browser tab to an agent running on their own computer, and take it back.
- **Category:** Developer tools (Chrome, Edge); Tabs and Web Development (Firefox); Developer Tools (Mac App Store).
- **Language:** English.
- **Homepage:** https://control.praecise.com
- **Support:** contact@praecise.com, https://praecise.com
- **Privacy policy:** https://control.praecise.com/docs/privacy/
- **Licence:** Apache-2.0
- **Publisher:** Praecise LTD
- **Mature content:** none. **Advertising:** none. **Payments:** none.

## Pictures

| File | Size | Used for |
|---|---|---|
| `images/offer.png` | 1280 by 800 | First screenshot, every store |
| `images/using.png` | 1280 by 800 | Second screenshot, every store |
| `images/tile.png` | 440 by 280 | Small promotional tile (Chrome, Edge) |
| `../../assets/icon-128.png` | 128 by 128 | Store icon (Chrome) |
| `../../assets/icon-512.png` | 512 by 512 | Logo (Edge takes 300 by 300 or larger) |

They are drawn from the extension's own popup by `shots.html`, which says at its top
how. Draw them again when the popup changes.

## The id, once a store gives one

A store gives the extension its own id, which is not the id the unpacked build has.
The program on the computer only answers an extension it knows, so the new id goes in
`EXTENSIONS` in `../../browser.ts` before the listing is made public. Until then a
store build connects and is refused.

## Order

1. `sh package.sh`.
2. Chrome Web Store: upload, fill in from [chrome.md](chrome.md), save as a draft. Copy
   the item's id into `EXTENSIONS`, release the program, then submit for review.
3. Edge Add-ons: the same package and [edge.md](edge.md). Its id goes in `EXTENSIONS` too.
4. addons.mozilla.org: [firefox.md](firefox.md). Firefox needs no id change.
5. Mac App Store: [safari.md](safari.md).
6. When each is public, the download button for that browser on control.praecise.com
   becomes the store's link.

## What a reviewer will ask

- **Why `debugger` (Chrome, Edge).** See the justification in [chrome.md](chrome.md). It
  is attached to the one tab the person offered, the browser shows its own "is
  debugging this browser" bar for as long as it is attached, and only eleven named
  commands are passed (`ALLOWED` in `../extension/background.js`). None of them runs
  code in the page.
- **How to try it without the program.** They cannot: the extension does nothing alone.
  The test instructions in each file say how to get the program and try it in two
  minutes.
- **Remote code.** There is none. Every script is in the package.

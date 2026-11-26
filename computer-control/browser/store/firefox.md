# Firefox Add-ons (addons.mozilla.org)

Developer Hub: https://addons.mozilla.org/developers/. A Mozilla account is free.

Package: `out/firefox.zip`. Source for review: `out/source.zip`, which is the same
files: nothing in the package is built, bundled or minified from anything else.

There are two ways, and both sign the extension so that a release Firefox installs it
for good:

- **Listed**: it has a page on addons.mozilla.org, and Firefox updates it by itself.
  This is the seamless one.
- **Unlisted**: Mozilla signs it and we serve the signed file from our own site.
  Firefox installs it from the download; updates are ours to serve.

From the command line, with API credentials made at
https://addons.mozilla.org/developers/addon/api/key/ and kept out of the repository:

```sh
cd ../extension-page
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npx web-ext sign --channel listed
```

The first listed version is easier to submit in the Developer Hub, where the listing
below is filled in at the same time.

## Describe add-on

**Name:** Praecise Control

**Add-on URL:** praecise-control

**Summary** (at most 250 characters)

Lets an AI agent on your own computer use the tab you offer it, on the site it is on, until you stop it. Nothing happens until you press the button on a tab.

**Description**

Praecise Control lets an AI agent running on your own computer use one browser tab that you offer it.

You stay in charge of which tab. Press the extension's button on a tab, then "Use this tab", and the agent can read that page and work it: click, type, scroll and take a picture of it. It can do this only on the site the tab was on when you offered it. When you press Stop, close the tab, or the tab leaves that site, the agent is cut off.

What it is for
- Letting an agent you run yourself (Claude Code, Codex, or any agent that speaks the Model Context Protocol) do a piece of work in a site you are already signed in to, without giving it your password.
- Working one page at a time, where you can see what it does.

What it does not do
- It does nothing until you press its button on a tab.
- It does not read the pages in your other tabs, or your history.
- It collects nothing and sends nothing to Praecise or to anyone else. It talks only to the Praecise Control program on your own computer, at 127.0.0.1.
- It shows no advertising and does no tracking.

What you need
The Praecise Control program on the same computer, which is free and open source: https://control.praecise.com. Without it the extension has nothing to connect to and does nothing.

Open source, Apache-2.0: https://github.com/Praecise/praecise-harness-environments/tree/main/computer-control
Privacy: https://control.praecise.com/docs/privacy/

**This add-on is experimental:** No

**This add-on requires payment, non-free services or software, or additional hardware:** No. It needs the Praecise Control program, which is free and open source.

**Categories:** Tabs; Web Development

**Support email:** contact@praecise.com

**Support website:** https://praecise.com

**Homepage:** https://control.praecise.com

**License:** Apache License 2.0

**This add-on has a Privacy Policy:** Yes

**Privacy policy**

Praecise Control does nothing until you press its button on a tab. It then passes that page's content, and input for it, between that tab and the Praecise Control program on your own computer, at 127.0.0.1, until you stop it, the tab closes or it leaves the site. It does not read your other tabs or your history. It collects nothing, and nothing is sent to Praecise or to anyone else. It has no analytics and no advertising. Full text: https://control.praecise.com/docs/privacy/

**Screenshots:** `images/offer.png`, `images/using.png`

## Data collection

The manifest declares `websiteContent` as required, which is the truth of it: the
offered page's content is passed to the program on the same computer. Firefox shows
this to the person when they install. Nothing is transmitted off the computer.

## Permissions

- `activeTab`: the extension is let into a page only by the person pressing its button on that tab.
- `scripting`: to put the extension's own script, `page.js` from the package, into that one tab so that it can be read and worked.

No host permission is requested and no remote code is loaded.

## Notes to reviewer

The extension does nothing alone: it connects to the Praecise Control program on the same computer (WebSocket to 127.0.0.1:17345), which is free and open source. No account is needed.

1. Install Node.js 22 or later, and download one file: https://raw.githubusercontent.com/Praecise/praecise-harness-environments/main/computer-control/browser/try.mjs
2. Run: node try.mjs
3. Open any web page, press the extension's button, then "Use this tab". The program prints the tab's title and how many elements it read.
4. Press the button again and Stop. The program prints that the tab was taken back.

The source is the package: no build step, no minifier, no bundler. Repository: https://github.com/Praecise/praecise-harness-environments/tree/main/computer-control/browser/extension-page

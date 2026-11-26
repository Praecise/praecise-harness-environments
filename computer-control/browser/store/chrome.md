# Chrome Web Store

Developer Dashboard: https://chrome.google.com/webstore/devconsole. A developer account
has a one-time registration fee and needs 2-Step Verification. The first upload is made
in the dashboard; later versions can be uploaded through the store's API.

Package: `out/chrome.zip`.

## Store listing

**Name** (from the manifest)

Praecise Control

**Summary** (from the manifest, at most 132 characters)

Lets an agent on this machine work one tab you offer it, on the site it is on, until you stop it.

**Description**

Praecise Control lets an AI agent running on your own computer use one browser tab that you offer it.

You stay in charge of which tab. Open the extension, press "Use this tab" beside the tab you choose, and the agent can read that page and work it: click, type, scroll and take a picture of it. It can do this only on the site the tab was on when you offered it. When you press Stop, close the tab, or the tab leaves that site, the agent is cut off.

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

**Category:** Developer Tools

**Language:** English

**Store icon:** `../../assets/icon-128.png`

**Screenshots:** `images/offer.png`, `images/using.png`

**Small promo tile:** `images/tile.png`

**Homepage URL:** https://control.praecise.com

**Support URL:** https://praecise.com

**Support email:** contact@praecise.com

**Mature content:** No

## Privacy

**Single purpose**

Praecise Control has one purpose: to let a person offer one browser tab to an AI agent running on their own computer, and to take it back. The agent can read and work that tab, on the site it was on when offered, until the person stops it.

**Permission justification: debugger**

The extension's whole function is to let a local agent operate one tab the person explicitly offered. It attaches the debugger only to that tab, only after the person presses "Use this tab" in the popup, and detaches when they press Stop, the tab closes, or the tab leaves the site it was offered on. Chrome shows its own notice for as long as it is attached. Only eleven named commands are passed to the tab: reading the page's accessibility tree and layout, taking a screenshot, scrolling an element into view, sending mouse and key events, inserting text, and navigating within the same site. No command that runs script in the page is passed. The debugger is the only API that gives real input events and the accessibility tree, which is what lets an agent work a page as a person does and not by injecting script.

**Permission justification: tabs**

The popup lists the titles of the open web pages so the person can choose which one to offer, and the extension checks the offered tab's address to hold the agent to that site. Tab titles and addresses are shown only in the popup and are not stored or sent anywhere.

**Host permission justification**

None is requested.

**Are you using remote code?**

No. Every script is in the package. The extension evaluates nothing it was sent.

**Data usage** (what the extension collects)

None of the categories is collected. The extension passes the offered page's content, and input for it, between that tab and the Praecise Control program on the same computer at 127.0.0.1. Nothing is collected by Praecise, sent to a server, sold or used for anything else.

Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://control.praecise.com/docs/privacy/

## Distribution

**Visibility:** Public. **Regions:** all. **Pricing:** free.

## Test instructions (for the reviewer)

The extension does nothing alone: it connects to the Praecise Control program on the same computer, which is free and open source. No account or sign-in is needed.

1. Install Node.js 22 or later, and download one file: https://raw.githubusercontent.com/Praecise/praecise-harness-environments/main/computer-control/browser/try.mjs
2. Run: node try.mjs
3. Open any web page, open the extension's popup and press "Use this tab". The browser shows its debugging notice, and the program prints the tab's title and how many elements it read.
4. Open the popup again and press Stop. The notice goes away and the program prints that the tab was taken back.

The program answers the extension whatever id the store gave it.

Source for every file in the package: https://github.com/Praecise/praecise-harness-environments/tree/main/computer-control/browser/extension

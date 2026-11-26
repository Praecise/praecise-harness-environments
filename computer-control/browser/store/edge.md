# Microsoft Edge Add-ons

Partner Center: https://partner.microsoft.com/dashboard/microsoftedge. It needs a
Microsoft Edge developer account. Certification can take up to seven business days.

Package: `out/chrome.zip`, the same one the Chrome Web Store is given.

## Properties

**Category:** Developer tools

**Privacy policy requirements:** Does your extension access, collect or transmit personal information? No.

**Privacy policy URL:** https://control.praecise.com/docs/privacy/

**Website URL:** https://control.praecise.com

**Support contact:** contact@praecise.com

**Mature content:** No

## Privacy

**Single purpose description**

Praecise Control has one purpose: to let a person offer one browser tab to an AI agent running on their own computer, and to take it back. The agent can read and work that tab, on the site it was on when offered, until the person stops it.

**Permission justification: debugger**

The extension's whole function is to let a local agent operate one tab the person explicitly offered. It attaches the debugger only to that tab, only after the person presses "Use this tab" in the popup, and detaches when they press Stop, the tab closes, or the tab leaves the site it was offered on. Edge shows its own notice for as long as it is attached. Only eleven named commands are passed: reading the page's accessibility tree and layout, taking a screenshot, scrolling an element into view, sending mouse and key events, inserting text, and navigating within the same site. No command that runs script in the page is passed.

**Permission justification: tabs**

The popup lists the titles of the open web pages so the person can choose which one to offer, and the extension checks the offered tab's address to hold the agent to that site. Nothing is stored or sent anywhere.

**Remote code:** No, I am not using remote code.

**Data usage:** nothing is collected. Tick the certification that the extension complies with the developer policies.

## Store listing (English)

**Display name:** Praecise Control (from the manifest)

**Description** (250 to 10,000 characters)

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

**Extension logo:** `../../assets/icon-512.png` (300 by 300 or larger)

**Small promotional tile:** `images/tile.png` (440 by 280)

**Screenshots:** `images/offer.png`, `images/using.png` (1280 by 800)

**Short description:** from the manifest.

**Search terms:** agent, automation, MCP, browser control, accessibility, developer tools

## Notes for certification

The extension does nothing alone: it connects to the Praecise Control program on the same computer, which is free and open source. No account or sign-in is needed.

1. Install Node.js 22 or later, and download one file: https://raw.githubusercontent.com/Praecise/praecise-harness-environments/main/computer-control/browser/try.mjs
2. Run: node try.mjs
3. Open any web page, open the extension's popup and press "Use this tab". The browser shows its debugging notice, and the program prints the tab's title and how many elements it read.
4. Open the popup again and press Stop. The notice goes away and the program prints that the tab was taken back.

The program answers the extension whatever id the store gave it.

Source: https://github.com/Praecise/praecise-harness-environments/tree/main/computer-control/browser/extension

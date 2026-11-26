# Safari (Mac App Store)

A Safari extension comes inside a Mac app. The app here, `Praecise Control for Safari`,
is already signed with Developer ID and notarized, and is what control.praecise.com
offers as a download: a person opens it once and turns the extension on in Safari's
settings. The Mac App Store gives the same app with one press, and updates it.

The project is in `../safari`, made by Apple's converter from `../extension-page`.
The App Store takes a build signed for it, which is a different signature from the one
the download has, and an app record in App Store Connect.

## App record (App Store Connect, My Apps, New App)

**Platform:** macOS

**Name:** Praecise Control for Safari

**Primary language:** English (U.S.)

**Bundle ID:** com.praecise.control.safari

**SKU:** praecise-control-safari

## App information

**Subtitle** (at most 30 characters)

One tab, offered to your agent

**Category:** Developer Tools

**Content rights:** it does not contain, show or access third-party content.

**Age rating:** 4+ (every answer None)

**Privacy policy URL:** https://control.praecise.com/docs/privacy/

## Pricing and availability

Free. All territories.

## App privacy

**Data collection:** No, we do not collect data from this app.

## Version 1.0

**Promotional text** (at most 170 characters)

Let an AI agent on your own Mac use one Safari tab you offer it. It works that tab, on that site, until you stop it.

**Description**

Praecise Control for Safari lets an AI agent running on your own Mac use one Safari tab that you offer it.

You stay in charge of which tab. Press the extension's button on a tab, then "Use this tab", and the agent can read that page and work it: click, type and scroll. It can do this only on the site the tab was on when you offered it. When you press Stop, close the tab, or the tab leaves that site, the agent is cut off.

It does nothing until you press its button on a tab. It does not read your other tabs or your history. It collects nothing and sends nothing to Praecise or to anyone else: it talks only to the Praecise Control program on your own Mac.

It needs the Praecise Control program on the same Mac, which is free and open source: https://control.praecise.com

**Keywords** (at most 100 characters)

agent,automation,MCP,browser,extension,developer,accessibility,assistant

**Support URL:** https://praecise.com

**Support email:** contact@praecise.com

**Marketing URL:** https://control.praecise.com

**Copyright:** 2026 Praecise LTD

**Screenshots** (macOS, 1280 by 800): `images/offer.png`, `images/using.png`

## App Review information

**Sign-in required:** No

**Notes**

This app carries a Safari Web Extension and has no other function. After installing, open Safari, Settings, Extensions, and turn on Praecise Control. The extension does nothing alone: it connects to the Praecise Control program on the same Mac (WebSocket to 127.0.0.1:17345), which is free and open source at https://control.praecise.com. No account is needed.

To try it: install Node.js 22 or later, download https://raw.githubusercontent.com/Praecise/praecise-harness-environments/main/computer-control/browser/try.mjs and run: node try.mjs
Open any web page in Safari, press the extension's button, allow it on that page, and press "Use this tab". The program prints the tab's title and how many elements it read.

## What Apple's agreement asks of a Safari extension, and how this one meets it

- **One purpose, and the app has the same purpose.** The app does nothing but carry the extension.
- **No tracking without consent.** It reads a page only after the person presses its button on that tab.
- **It is not turned on by a script.** A person turns it on in Safari's settings; nothing here does it for them.
- **No advertising, no changed search, no redirected links.**

// The signed-in browser, through the real extension in a real Chromium. It runs where a
// browser is named:
//
//   PRAECISE_TEST_CHROMIUM=/path/to/chrome node --test tests/browser-real.test.ts
//
// A page is served on this machine, the extension's own popup is opened and its button
// pressed to offer the page's tab, and the tab is then worked as a screen.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { computerTool, elementsTool } from "@praecise/harness";

import { EXTENSION, signedInBrowser } from "../computer-control/browser.ts";

const CHROMIUM = process.env.PRAECISE_TEST_CHROMIUM;
const FOLDER = fileURLToPath(new URL("../computer-control/browser/extension", import.meta.url));

const PAGE =
  "<!doctype html><title>Orders</title><h1>Orders</h1>" +
  '<label>Name <input id="n" value="old"></label>' +
  "<button onclick=\"document.getElementById('o').textContent='Saved '+document.getElementById('n').value;this.remove()\">Save</button>" +
  '<p id="o">Not saved.</p>';

const serve = (): Promise<{ origin: string; close(): void }> =>
  new Promise((resolve) => {
    const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(PAGE));
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() }));
  });

/** As much of the DevTools protocol as pressing a button in the popup needs. */
async function devtools(url: string) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  let next = 1;
  const waiting = new Map<number, (message: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
  const events = new Map<string, () => void>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; method?: string };
    if (message.id) waiting.get(message.id)?.(message as never);
    else if (message.method) events.get(message.method)?.();
  });
  /** Resolves when the browser next says this has happened. */
  const once = (method: string): Promise<void> => new Promise((resolve) => events.set(method, resolve));
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result ?? {})));
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, once, close: () => socket.close() };
}

test("a tab offered from the extension is worked as a screen, and cut off when it leaves its site", { skip: !CHROMIUM }, async (t) => {
  const site = await serve();
  const elsewhere = await serve();
  const profile = await mkdtemp(join(tmpdir(), "browser-real-"));
  const child = spawn(
    CHROMIUM!,
    ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", `--disable-extensions-except=${FOLDER}`, `--load-extension=${FOLDER}`, "--window-size=1000,700", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  t.after(async () => {
    child.kill();
    site.close();
    elsewhere.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let said = "";
    child.stderr.on("data", (chunk) => {
      said += String(chunk);
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(said);
      if (found) resolve(found[1]!);
    });
    child.on("exit", () => reject(new Error(`the browser stopped: ${said.slice(-300)}`)));
  });

  let listening!: () => void;
  const ready = new Promise<void>((resolve) => (listening = resolve));
  const pending = signedInBrowser({ waitMs: 30_000, listening });
  // Awaited below; a failure before then is this test's to report, not a loose end.
  pending.catch(() => undefined);
  await ready;

  const browser = await devtools(endpoint);
  // A page open in a tab, as a person has one.
  const opened = await browser.send("Target.createTarget", { url: "about:blank" });
  const page = String((await browser.send("Target.attachToTarget", { targetId: opened.targetId, flatten: true })).sessionId);
  await browser.send("Page.enable", {}, page);
  const arrived = browser.once("Page.loadEventFired");
  await browser.send("Page.navigate", { url: `${site.origin}/` }, page);
  await arrived;
  await browser.send("Target.detachFromTarget", { sessionId: page });

  // The person's part: open the extension's popup and press the button beside the page.
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Page.enable", {}, String(sessionId));
  const loaded = browser.once("Page.loadEventFired");
  await browser.send("Page.navigate", { url: `chrome-extension://${EXTENSION}/popup.html` }, String(sessionId));
  await loaded;
  const pressed = await browser.send(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        for (let tries = 0; tries < 100; tries++) {
          const button = [...document.querySelectorAll("button")].find((each) => (each.dataset.url || "").startsWith(${JSON.stringify(site.origin)}));
          if (button) { button.click(); return button.textContent; }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return document.body.innerText;
      })()`,
    },
    String(sessionId),
  );
  assert.equal((pressed.result as { value: string }).value, "Use this tab");

  // A popup closes once its button is pressed and leaves the tab it was opened over in front. Here the
  // popup is a tab of its own, so the page is put in front the way it would be.
  await browser.send(
    "Runtime.evaluate",
    { awaitPromise: true, expression: `chrome.tabs.query({}).then((all) => chrome.tabs.update(all.find((tab) => (tab.url || tab.pendingUrl || "").startsWith(${JSON.stringify(site.origin)})).id, { active: true }))` },
    String(sessionId),
  );

  const screen = await pending;
  t.after(() => screen.close());
  assert.ok(screen.width > 100 && screen.height > 100, `${screen.width} by ${screen.height}`);

  const tool = elementsTool(screen, { settleMs: 200 });
  const read = String(await tool.run({ action: "read" }));
  assert.match(read, /^page "Orders" \[ref_\d+\]/);
  assert.match(read, /textbox "Name" = "old" \[ref_\d+\]/);
  const field = /textbox "Name" = "old" \[(ref_\d+)\]/.exec(read)![1]!;
  const save = /button "Save" \[(ref_\d+)\]/.exec(read)![1]!;

  assert.match(String(await tool.run({ action: "fill", ref: field, value: "new name" })), /changed: textbox "Name" = "new name"/);
  const clicked = String(await tool.run({ action: "click", ref: save }));
  assert.ok(clicked.includes(`gone: button "Save" [${save}]`), clicked);
  assert.match(String(await tool.run({ action: "text" })), /Saved new name/);
  await assert.rejects(Promise.resolve().then(() => tool.run({ action: "click", ref: save })), /no longer on the page/);

  // The picture is the size the screen says it is, whatever the display.
  const shot = (await computerTool(screen).run({ action: "screenshot" })) as Record<symbol, { mime: string; data: string }[]>;
  const png = Buffer.from(shot[Object.getOwnPropertySymbols(shot)[0]!]![0]!.data, "base64");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [screen.width, screen.height]);

  // The popup now says a tab is in use.
  const state = await browser.send("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression: `chrome.runtime.sendMessage({ type: "state" }).then((answer) => answer.value && answer.value.origin)` }, String(sessionId));
  assert.equal((state.result as { value: string }).value, site.origin);

  // Another site is refused, and the tab stays where it was.
  await assert.rejects(screen.open(`${elsewhere.origin}/`), /may not be taken to another site/);
  assert.match(String(await tool.run({ action: "text" })), /Saved new name/);

  // The person stops it, and the agent is cut off with the reason.
  await browser.send("Runtime.evaluate", { awaitPromise: true, expression: `chrome.runtime.sendMessage({ type: "stop" })` }, String(sessionId));
  await assert.rejects(Promise.resolve().then(() => tool.run({ action: "read" })), /no longer offered: the person stopped it/);
  browser.close();
});

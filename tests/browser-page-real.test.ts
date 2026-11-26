// Praecise Control for Firefox and Safari, which reads and works a page from inside it.
// The same extension is loaded here in a Chromium, where it can be driven:
//
//   PRAECISE_TEST_CHROMIUM=/path/to/chrome node --test tests/browser-page-real.test.ts
//
// What is tried is the page script, the background and the side that listens for them.
// What is not: the press of the extension's own button on a tab, which is what lets it
// into that tab in a person's browser. Here it is let into every page in advance.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { computerTool, elementsTool } from "@praecise/harness";

import { EXTENSION, signedInBrowser } from "../computer-control/browser.ts";

const CHROMIUM = process.env.PRAECISE_TEST_CHROMIUM;
const FOLDER = fileURLToPath(new URL("../computer-control/browser/extension-page", import.meta.url));
const KEYED = fileURLToPath(new URL("../computer-control/browser/extension/manifest.json", import.meta.url));

const PAGE =
  "<!doctype html><title>Orders</title><h1>Orders</h1>" +
  '<form onsubmit="event.preventDefault();document.getElementById(\'o\').textContent=\'Searched \'+document.getElementById(\'q\').value"><label>Search <input id="q" type="search"></label></form>' +
  '<label>Name <input id="n" value="old"></label><label>Secret <input type="password" value="hunter2"></label>' +
  '<label><input type="checkbox" id="p"> Paid only</label>' +
  '<select aria-label="Status"><option>Open</option><option>Closed</option></select>' +
  "<button onclick=\"document.getElementById('o').textContent='Saved '+document.getElementById('n').value;this.remove()\">Save</button>" +
  '<p id="o">Not saved.</p><div style="height:2500px"></div><a href="#far">Far link</a>';

const serve = (): Promise<{ origin: string; close(): void }> =>
  new Promise((resolve) => {
    const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(PAGE));
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() }));
  });

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
  const once = (method: string): Promise<void> => new Promise((resolve) => events.set(method, resolve));
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result ?? {})));
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const open = async (url: string): Promise<string> => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const session = String((await send("Target.attachToTarget", { targetId, flatten: true })).sessionId);
    await send("Page.enable", {}, session);
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url }, session);
    await loaded;
    return session;
  };
  return { send, open, close: () => socket.close() };
}

test("a page is read and worked from inside it, and the agent is held to its site", { skip: !CHROMIUM }, async (t) => {
  const site = await serve();
  const elsewhere = await serve();
  const profile = await mkdtemp(join(tmpdir(), "browser-page-"));
  // The extension as it is, let into every page in advance and given the id this test knows it by.
  const folder = join(profile, "extension");
  await cp(FOLDER, folder, { recursive: true });
  const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")) as Record<string, unknown>;
  await writeFile(join(folder, "manifest.json"), JSON.stringify({ ...manifest, key: (JSON.parse(await readFile(KEYED, "utf8")) as { key: string }).key, host_permissions: ["<all_urls>"], permissions: ["activeTab", "scripting", "tabs"], background: { service_worker: "background.js" } }));

  const child = spawn(CHROMIUM!, ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${join(profile, "data")}`, "--no-first-run", `--disable-extensions-except=${folder}`, `--load-extension=${folder}`, "--window-size=1000,700", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
  pending.catch(() => undefined);
  await ready;

  const browser = await devtools(endpoint);
  const popup = await browser.open(`chrome-extension://${EXTENSION}/popup.html`);
  await browser.open(`${site.origin}/`);
  const offered = await browser.send(
    "Runtime.evaluate",
    { awaitPromise: true, returnByValue: true, expression: `chrome.tabs.query({}).then((all) => chrome.runtime.sendMessage({ type: "offer", tabId: all.find((tab) => (tab.url || "").startsWith(${JSON.stringify(site.origin)})).id }))` },
    popup,
  );
  assert.equal((offered.result as { value: { ok: boolean; error?: string } }).value.ok, true, JSON.stringify(offered.result));

  const screen = await pending;
  t.after(() => screen.close());
  assert.ok(screen.width > 100 && screen.height > 100);
  const tool = elementsTool(screen, { settleMs: 200 });
  const ref = (listed: string, what: RegExp): string => {
    const found = what.exec(listed);
    assert.ok(found, `${String(what)} is not in:\n${listed}`);
    return found[1]!;
  };

  const read = String(await tool.run({ action: "read" }));
  assert.match(read, /^page "Orders" \[ref_\d+\]/);
  assert.match(read, /heading "Orders" \[ref_\d+\]/);
  assert.match(read, /text "Not saved\." \[ref_\d+\]/);
  // What a password field holds is never read.
  assert.match(read, /textbox "Secret" \[ref_\d+\]/);
  assert.doesNotMatch(read, /hunter2/);
  const worked = String(await tool.run({ action: "read", filter: "interactive" }));
  const field = ref(worked, /textbox "Name" = "old" \[(ref_\d+)\]/);
  const save = ref(worked, /button "Save" \[(ref_\d+)\]/);
  const paid = ref(worked, /checkbox "Paid only" \[(ref_\d+)\]/);
  const status = ref(worked, /combobox "Status" = "Open" \[(ref_\d+)\]/);
  const search = ref(worked, /searchbox "Search" \[(ref_\d+)\]/);

  assert.match(String(await tool.run({ action: "fill", ref: field, value: "new name" })), /changed: textbox "Name" = "new name"/);
  assert.match(String(await tool.run({ action: "fill", ref: status, value: "Closed" })), /changed: combobox "Status" = "Closed"/);
  await assert.rejects(Promise.resolve().then(() => tool.run({ action: "fill", ref: status, value: "Lost" })), /has no choice called "Lost"/);
  assert.match(String(await tool.run({ action: "click", ref: paid })), /changed: checkbox "Paid only" \([^)]*checked/);

  const clicked = String(await tool.run({ action: "click", ref: save }));
  assert.ok(clicked.includes(`gone: button "Save" [${save}]`), clicked);
  assert.match(String(await tool.run({ action: "text" })), /Saved new name/);
  await assert.rejects(Promise.resolve().then(() => tool.run({ action: "click", ref: save })), /no longer on the page/);

  // The pointer and the keyboard, by position.
  const pixels = computerTool(screen);
  const at = /in view at \[(\d+), (\d+)\]/.exec(String(await tool.run({ action: "scroll_to", ref: search })))!;
  await pixels.run({ action: "left_click", coordinate: [Number(at[1]), Number(at[2])] });
  await pixels.run({ action: "type", text: "boots" });
  await pixels.run({ action: "key", text: "Return" });
  assert.match(String(await tool.run({ action: "text" })), /Searched boots/);
  await pixels.run({ action: "key", text: "ctrl+a" });
  await pixels.run({ action: "type", text: "hats" });
  assert.match(String(await tool.run({ action: "read", filter: "interactive" })), /searchbox "Search" = "hats"/);
  await assert.rejects(Promise.resolve().then(() => pixels.run({ action: "key", text: "ctrl+s" })), /cannot be pressed from inside a page/);

  const far = ref(String(await tool.run({ action: "find", query: "far link" })), /link "Far link" \[(ref_\d+)\]/);
  assert.match(String(await tool.run({ action: "scroll_to", ref: far })), /is in view at \[\d+, \d+\]/);

  // A picture, in the page's own pixels. The tab has to be the one in front.
  await browser.send("Runtime.evaluate", { awaitPromise: true, expression: `chrome.tabs.query({}).then((all) => chrome.tabs.update(all.find((tab) => (tab.url || "").startsWith(${JSON.stringify(site.origin)})).id, { active: true }))` }, popup);
  const shot = (await pixels.run({ action: "screenshot" })) as Record<symbol, { mime: string; data: string }[]>;
  const png = Buffer.from(shot[Object.getOwnPropertySymbols(shot)[0]!]![0]!.data, "base64");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [screen.width, screen.height]);

  await assert.rejects(screen.open(`${elsewhere.origin}/`), /may not be taken to another site/);
  await browser.send("Runtime.evaluate", { awaitPromise: true, expression: `chrome.runtime.sendMessage({ type: "stop" })` }, popup);
  await assert.rejects(Promise.resolve().then(() => tool.run({ action: "read" })), /no longer offered: the person stopped it/);
  browser.close();
});

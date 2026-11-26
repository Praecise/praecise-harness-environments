// Praecise Control in a real Firefox, driven through geckodriver. It runs where one is named:
//
//   PRAECISE_TEST_GECKODRIVER=/path/to/geckodriver node --test tests/firefox-real.test.ts
//
// As in tests/browser-page-real.test.ts, the extension is let into every page in advance:
// the press of its own button on a tab cannot be made from here.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { computerTool, elementsTool } from "@praecise/harness";

import { signedInBrowser } from "../computer-control/browser.ts";

const GECKODRIVER = process.env.PRAECISE_TEST_GECKODRIVER;
const FOLDER = fileURLToPath(new URL("../computer-control/browser/extension-page", import.meta.url));
const UUID = "0f6f9c1e-6f0a-4c59-9d0b-3a5f8f3b7c11";

const PAGE =
  "<!doctype html><title>Orders</title><h1>Orders</h1>" +
  '<form onsubmit="event.preventDefault();document.getElementById(\'o\').textContent=\'Searched \'+document.getElementById(\'q\').value"><label>Search <input id="q" type="search"></label></form>' +
  '<label>Name <input id="n" value="old"></label>' +
  "<button onclick=\"document.getElementById('o').textContent='Saved '+document.getElementById('n').value;this.remove()\">Save</button>" +
  '<p id="o">Not saved.</p>';

test("Firefox: a page is read and worked from inside it", { skip: !GECKODRIVER }, async (t) => {
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(PAGE));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const work = await mkdtemp(join(process.env.PRAECISE_TEST_SCRATCH ?? tmpdir(), "firefox-real-"));
  const folder = join(work, "extension");
  await cp(FOLDER, folder, { recursive: true });
  const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")) as Record<string, unknown>;
  await writeFile(join(folder, "manifest.json"), JSON.stringify({ ...manifest, host_permissions: ["<all_urls>"], permissions: ["activeTab", "scripting", "tabs"], background: { scripts: ["background.js"] } }));
  execFileSync("python3", ["-m", "zipfile", "-c", join(work, "extension.xpi"), "manifest.json", "background.js", "page.js", "popup.html", "popup.js", "icons"], { cwd: folder });

  const port = 4500 + Math.floor(Math.random() * 400);
  const driver = spawn(GECKODRIVER!, ["--port", String(port), "--allow-system-access"], { stdio: ["ignore", "pipe", "pipe"] });
  let session = "";
  const wd = async (method: string, path: string, body?: unknown): Promise<any> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
    const answer = (await response.json()) as { value: any };
    if (!response.ok) throw new Error(`${path}: ${answer.value?.message ?? response.status}`);
    return answer.value;
  };
  t.after(async () => {
    if (session) await wd("DELETE", `/session/${session}`).catch(() => undefined);
    driver.kill();
    server.close();
    await rm(work, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    driver.stdout.on("data", (chunk) => String(chunk).includes("Listening") && resolve());
    driver.on("exit", () => reject(new Error("geckodriver stopped")));
  });

  let listening!: () => void;
  const ready = new Promise<void>((resolve) => (listening = resolve));
  const pending = signedInBrowser({ waitMs: 60_000, listening });
  pending.catch(() => undefined);
  await ready;

  const made = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "firefox", "moz:firefoxOptions": { args: ["-headless"], prefs: { "extensions.webextensions.uuids": JSON.stringify({ "control@praecise.com": UUID }) } } } },
  });
  session = made.sessionId;
  const at = `/session/${session}`;
  await wd("POST", `${at}/moz/addon/install`, { addon: (await readFile(join(work, "extension.xpi"))).toString("base64"), temporary: true });
  await wd("POST", `${at}/url`, { url: `${origin}/` });
  const page = await wd("GET", `${at}/window`);
  // The extension's own page cannot be gone to as a web page is. It is opened the way the browser opens it.
  const before = (await wd("GET", `${at}/window/handles`)) as string[];
  await wd("POST", `${at}/moz/context`, { context: "chrome" });
  await wd("POST", `${at}/execute/sync`, {
    script: "gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });",
    args: [`moz-extension://${UUID}/popup.html`],
  });
  await wd("POST", `${at}/moz/context`, { context: "content" });
  const popup = ((await wd("GET", `${at}/window/handles`)) as string[]).find((each) => !before.includes(each))!;
  await wd("POST", `${at}/window`, { handle: popup });
  await wd("POST", `${at}/execute/async`, { script: "const done = arguments[arguments.length - 1]; (function wait() { document.querySelector('#heading').textContent ? done(true) : setTimeout(wait, 50); })();", args: [] });
  const offered = await wd("POST", `${at}/execute/async`, {
    script: `const done = arguments[arguments.length - 1]; browser.tabs.query({}).then((all) => browser.runtime.sendMessage({ type: "offer", tabId: all.find((tab) => (tab.url || "").startsWith(arguments[0])).id })).then(done, (err) => done({ ok: false, error: String(err) }));`,
    args: [origin],
  });
  assert.equal(offered.ok, true, JSON.stringify(offered));

  const screen = await pending;
  t.after(() => screen.close());
  const tool = elementsTool(screen, { settleMs: 200 });
  const ref = (listed: string, what: RegExp): string => {
    const found = what.exec(listed);
    assert.ok(found, `${String(what)} is not in:\n${listed}`);
    return found[1]!;
  };
  const read = String(await tool.run({ action: "read" }));
  assert.match(read, /^page "Orders" \[ref_\d+\]/);
  assert.match(read, /text "Not saved\." \[ref_\d+\]/);
  const worked = String(await tool.run({ action: "read", filter: "interactive" }));
  const field = ref(worked, /textbox "Name" = "old" \[(ref_\d+)\]/);
  const save = ref(worked, /button "Save" \[(ref_\d+)\]/);
  const search = ref(worked, /searchbox "Search" \[(ref_\d+)\]/);

  assert.match(String(await tool.run({ action: "fill", ref: field, value: "new name" })), /changed: textbox "Name" = "new name"/);
  assert.ok(String(await tool.run({ action: "click", ref: save })).includes(`gone: button "Save" [${save}]`));
  assert.match(String(await tool.run({ action: "text" })), /Saved new name/);
  await assert.rejects(Promise.resolve().then(() => tool.run({ action: "click", ref: save })), /no longer on the page/);

  const pixels = computerTool(screen);
  const where = /in view at \[(\d+), (\d+)\]/.exec(String(await tool.run({ action: "scroll_to", ref: search })))!;
  await pixels.run({ action: "left_click", coordinate: [Number(where[1]), Number(where[2])] });
  await pixels.run({ action: "type", text: "boots" });
  await pixels.run({ action: "key", text: "Return" });
  assert.match(String(await tool.run({ action: "text" })), /Searched boots/);

  // A picture, with the page's tab in front.
  await wd("POST", `${at}/window`, { handle: page });
  const shot = (await pixels.run({ action: "screenshot" })) as Record<symbol, { mime: string; data: string }[]>;
  const png = Buffer.from(shot[Object.getOwnPropertySymbols(shot)[0]!]![0]!.data, "base64");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [screen.width, screen.height]);
});

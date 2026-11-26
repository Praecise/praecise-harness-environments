// The small program a store's reviewer runs, spoken to as an extension speaks to it:
// frames masked as a browser masks them, a long answer in one frame, and no answer at
// all for a caller that is not an extension.
//
//   node --test tests/browser-try.test.ts

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const TRY = fileURLToPath(new URL("../computer-control/browser/try.mjs", import.meta.url));

const frame = (text: string): Buffer => {
  const body = Buffer.from(text);
  const mask = randomBytes(4);
  const head = body.length < 126 ? Buffer.from([0x81, 0x80 | body.length]) : body.length < 65536 ? Buffer.from([0x81, 0x80 | 126, body.length >> 8, body.length & 255]) : Buffer.concat([Buffer.from([0x81, 0x80 | 127]), Buffer.from(new BigUint64Array([BigInt(body.length)]).buffer).reverse()]);
  return Buffer.concat([head, mask, body.map((byte, at) => byte ^ mask[at & 3]!)]);
};

const dial = (origin: string): Promise<{ status: string; socket: ReturnType<typeof connect>; next(): Promise<string> }> =>
  new Promise((resolve, reject) => {
    const socket = connect(17345, "127.0.0.1");
    let got = Buffer.alloc(0);
    let wake: (() => void) | undefined;
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      got = Buffer.concat([got, chunk]);
      wake?.();
    });
    socket.on("connect", () => socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:17345\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`));
    const until = async (ready: () => boolean): Promise<void> => {
      while (!ready()) await new Promise<void>((done) => (wake = done));
    };
    void until(() => got.includes("\r\n\r\n")).then(() => {
      const end = got.indexOf("\r\n\r\n") + 4;
      const status = got.subarray(0, got.indexOf("\r\n")).toString();
      got = got.subarray(end);
      resolve({
        status,
        socket,
        // A short unmasked text frame, as the program sends them.
        next: async () => {
          await until(() => got.length >= 2 && got.length >= 2 + (got[1]! & 127));
          const length = got[1]! & 127;
          const text = got.subarray(2, 2 + length).toString();
          got = got.subarray(2 + length);
          return text;
        },
      });
    });
  });

test("the reviewer's program reads an offered tab, from either extension, and answers nothing else", async (t) => {
  const child = spawn(process.execPath, [TRY], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  let printed = "";
  let wake: (() => void) | undefined;
  child.stdout.on("data", (chunk) => {
    printed += String(chunk);
    wake?.();
  });
  const said = async (text: string): Promise<void> => {
    while (!printed.includes(text)) await new Promise<void>((done) => (wake = done));
  };
  await said("Waiting for a tab");

  // A web page is not an extension.
  const page = await dial("https://example.com");
  assert.match(page.status, /403/);
  page.socket.destroy();

  // The Chromium extension: the browser's own command is asked, and a long answer is read whole.
  const chromium = await dial("chrome-extension://anyidthestoregaveit");
  assert.match(chromium.status, /101/);
  chromium.socket.write(frame(JSON.stringify({ type: "offered", tab: { id: 7, url: "https://orders.example.com/", title: "Orders" } })));
  assert.deepEqual(JSON.parse(await chromium.next()), { id: 1, method: "Accessibility.getFullAXTree", params: {} });
  chromium.socket.write(frame(JSON.stringify({ id: 1, result: { nodes: Array.from({ length: 3000 }, (_, n) => ({ nodeId: String(n), role: { value: "button" }, name: { value: `Button number ${n}` } })) } })));
  await said("Read the tab: 3000 elements");
  chromium.socket.write(frame(JSON.stringify({ type: "withdrawn", reason: "the person stopped it" })));
  await said("Taken back: the person stopped it.");
  chromium.socket.destroy();
  await said("The extension went away.");

  // The Firefox and Safari extension answers as a screen and is asked to read.
  const firefox = await dial("moz-extension://0f6d2c1e-1111-2222-3333-444455556666");
  firefox.socket.write(frame(JSON.stringify({ type: "offered", speaks: "screen", tab: { id: 1, url: "https://wiki.example.com/", title: "Team wiki" }, window: { width: 800, height: 600 } })));
  assert.deepEqual(JSON.parse(await firefox.next()), { id: 1, method: "read", params: {} });
  firefox.socket.write(frame(JSON.stringify({ id: 1, result: [{ ref: "e1", role: "link", name: "Home" }, { ref: "e2", role: "button", name: "Edit" }] })));
  await said("Read the tab: 2 elements");
  assert.match(printed, /Offered: "Team wiki" at https:\/\/wiki\.example\.com\//);
  firefox.socket.destroy();
});

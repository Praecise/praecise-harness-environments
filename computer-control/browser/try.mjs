#!/usr/bin/env node
// The smallest program a Praecise Control extension will connect to: it waits for a tab
// to be offered, reads that tab once, says what it found, and says when the tab is
// taken back. It is for trying an extension by hand, and for a store's reviewer. It
// needs nothing installed beside Node 22 or later.
//
//   node try.mjs
//
// Then open a web page, open the extension and press "Use this tab".

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = 17345;
const say = (text) => process.stdout.write(`${text}\n`);

const server = createServer((_request, response) => response.writeHead(426).end());
server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  // Only an extension is answered. No web page can say it is one.
  if (typeof key !== "string" || !/^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(String(request.headers.origin ?? ""))) return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")}\r\n\r\n`);
  say("The extension is connected.");

  const send = (message) => {
    const text = Buffer.from(JSON.stringify(message));
    const head = text.length < 126 ? Buffer.from([0x81, text.length]) : Buffer.from([0x81, 126, text.length >> 8, text.length & 255]);
    socket.write(Buffer.concat([head, text]));
  };
  const heard = (message) => {
    if (message.type === "offered") {
      say(`Offered: "${message.tab.title}" at ${message.tab.url}`);
      // One extension answers as a screen; the other passes the browser's own commands.
      send(message.speaks === "screen" ? { id: 1, method: "read", params: {} } : { id: 1, method: "Accessibility.getFullAXTree", params: {} });
    } else if (message.id === 1) {
      if (message.error) return say(`It could not be read: ${message.error}`);
      const found = Array.isArray(message.result) ? message.result : (message.result?.nodes ?? []);
      say(`Read the tab: ${found.length} elements. Press Stop in the extension to take it back.`);
    } else if (message.type === "withdrawn") say(`Taken back: ${message.reason}.`);
  };

  // Frames from a browser are masked, and a long message may come in several.
  let waiting = Buffer.alloc(0);
  let parts = [];
  socket.on("data", (chunk) => {
    waiting = Buffer.concat([waiting, chunk]);
    for (;;) {
      if (waiting.length < 2) return;
      const code = waiting[0] & 15;
      let length = waiting[1] & 127;
      let at = 2;
      if (length === 126) {
        if (waiting.length < 4) return;
        length = waiting.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (waiting.length < 10) return;
        length = Number(waiting.readBigUInt64BE(2));
        at = 10;
      }
      const masked = Boolean(waiting[1] & 128);
      if (waiting.length < at + (masked ? 4 : 0) + length) return;
      const mask = masked ? waiting.subarray(at, at + 4) : undefined;
      at += masked ? 4 : 0;
      const body = Buffer.from(waiting.subarray(at, at + length));
      if (mask) for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i & 3];
      const last = Boolean(waiting[0] & 128);
      waiting = waiting.subarray(at + length);
      if (code === 8) return socket.end();
      if (code === 9) socket.write(Buffer.concat([Buffer.from([0x8a, body.length]), body]));
      if (code > 2) continue;
      parts.push(body);
      if (!last) continue;
      const text = Buffer.concat(parts).toString("utf8");
      parts = [];
      try {
        heard(JSON.parse(text));
      } catch {
        // Not something an extension says.
      }
    }
  });
  // A line the other end has finished with is finished here too.
  socket.on("end", () => socket.end());
  socket.on("close", () => say("The extension went away."));
  socket.on("error", () => undefined);
});
server.listen(PORT, "127.0.0.1", () => say(`Waiting for a tab on 127.0.0.1:${PORT}. Open a web page, open the extension and press "Use this tab".`));

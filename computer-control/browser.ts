// The browser a person is signed in to, as a screen for praecise-harness.
//
//   import { computer, elements } from "@praecise/harness";
//   import { signedInBrowser } from "@praecise/harness-environments/computer-control/browser";
//
//   const screen = await signedInBrowser();     // waits for a tab to be offered
//   export default elements(screen);
//
// The person installs Praecise Control in their browser and offers one tab from it. The
// extension connects to this machine only. In Chrome and its relatives
// (browser/extension) it attaches the browser's own debugger to that tab and passes on
// what the harness's browser screen asks. In Firefox and Safari (browser/extension-page),
// which give an extension no debugger, it reads and works the page from inside it and
// answers as a screen itself. Either way the agent is cut off when the tab leaves its
// site, is closed, or the person stops it.
//
// Nothing is installed beside the extension: this listens with Node's own modules.

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { browserScreen, type Screen } from "@praecise/harness";

import { appScreen, type Helper } from "./index.ts";

/** The extension's id, which follows from the key in its manifest. */
export const EXTENSION = "aadpnkpndmkmccflljbpklaiehkhjekb";
/** The port the extension looks for an agent on. */
export const PORT = 17345;

export interface SignedInBrowserOptions {
  /** Milliseconds to wait for a tab to be offered. Five minutes unless said. */
  waitMs?: number;
  /** Called once this is listening, for something that tells the person to offer a tab. */
  listening?: () => void;
  /** The port to listen on, for an extension built to look elsewhere. */
  port?: number;
  /** The extension's id, for one built from another key. */
  extension?: string;
}

interface Listener {
  (event: { data?: unknown }): void;
}

/** A WebSocket's frames, as far as lines of JSON between two programs need them. */
function frames(socket: Duplex, heard: (text: string) => void, closed: () => void): { say(text: string): void; end(): void } {
  let held = Buffer.alloc(0);
  let pieces: Buffer[] = [];
  const write = (opcode: number, payload: Buffer): void => {
    const length = payload.length;
    const head = length < 126 ? Buffer.from([0x80 | opcode, length]) : length < 65_536 ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff]) : Buffer.alloc(10);
    if (length >= 65_536) {
      head[0] = 0x80 | opcode;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([head, payload]));
  };
  socket.on("data", (chunk: Buffer) => {
    held = Buffer.concat([held, chunk]);
    for (;;) {
      if (held.length < 2) return;
      const opcode = held[0]! & 0x0f;
      const final = (held[0]! & 0x80) !== 0;
      const masked = (held[1]! & 0x80) !== 0;
      let length = held[1]! & 0x7f;
      let at = 2;
      if (length === 126) {
        if (held.length < 4) return;
        length = held.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (held.length < 10) return;
        length = Number(held.readBigUInt64BE(2));
        at = 10;
      }
      const start = at + (masked ? 4 : 0);
      if (held.length < start + length) return;
      const payload = Buffer.from(held.subarray(start, start + length));
      if (masked) for (let nth = 0; nth < payload.length; nth++) payload[nth] = payload[nth]! ^ held[at + (nth % 4)]!;
      held = held.subarray(start + length);
      if (opcode === 8) {
        socket.end();
        return;
      }
      if (opcode === 9) write(10, payload);
      else if (opcode === 0 || opcode === 1) {
        pieces.push(payload);
        if (final) {
          heard(Buffer.concat(pieces).toString("utf8"));
          pieces = [];
        }
      }
    }
  });
  socket.on("close", closed);
  socket.on("error", closed);
  return { say: (text) => write(1, Buffer.from(text, "utf8")), end: () => socket.end() };
}

/**
 * Wait for a tab to be offered, and return it as a screen.
 *
 * The screen is the one tab. Once the tab is withdrawn every action on it is refused
 * with the reason, and another tab is another call.
 */
export async function signedInBrowser(options: SignedInBrowserOptions = {}): Promise<Screen & { open(url: string): Promise<void>; close(): Promise<void> }> {
  const origin = `chrome-extension://${options.extension ?? EXTENSION}`;
  // Firefox and Safari give each install an id of its own, so theirs is known by its kind. No web page can say it is one.
  const ours = (from: string | undefined): boolean => from === origin || /^(moz-extension|safari-web-extension):\/\//.test(from ?? "");
  let line: { say(text: string): void; end(): void } | undefined;
  /** Why the tab can no longer be worked, once it cannot. */
  let gone: string | undefined;
  let tab: { id: number; url: string; title: string } | undefined;
  /** Set where the extension answers as a screen itself, with the size of the page as it is shown. */
  let page: { width: number; height: number } | undefined;
  const sockets = new Set<Listener>();
  const waiting = new Map<number, number>();
  const asking = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();
  let offered: (() => void) | undefined;
  let refused: ((reason: Error) => void) | undefined;

  const tell = (message: Record<string, unknown>): void => {
    for (const listener of sockets) listener({ data: JSON.stringify(message) });
  };

  const server = createServer((_request, response) => {
    response.writeHead(426).end();
  });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    const key = request.headers["sec-websocket-key"];
    // Only the extension. A web page cannot say it is one: the browser writes this header.
    if (!ours(request.headers.origin) || typeof key !== "string" || line) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    line = frames(
      socket,
      (text) => {
        let message: { type?: string; id?: number; result?: unknown; error?: string; reason?: string; method?: string; params?: unknown; tab?: typeof tab; speaks?: string; window?: typeof page };
        try {
          message = JSON.parse(text) as typeof message;
        } catch {
          return;
        }
        if (message.type === "offered" && message.tab && !tab) {
          tab = message.tab;
          if (message.speaks === "screen") page = message.window;
          offered?.();
        } else if (message.type === "withdrawn") {
          gone = `the tab is no longer offered: ${message.reason ?? "it was withdrawn"}`;
        } else if (message.type === "event" && message.method) {
          tell({ method: message.method, params: message.params ?? {}, sessionId: "tab" });
        } else if (typeof message.id === "number" && asking.has(message.id)) {
          const asked = asking.get(message.id)!;
          asking.delete(message.id);
          if (typeof message.error === "string") asked.reject(new Error(message.error));
          else asked.resolve(message.result);
        } else if (typeof message.id === "number" && waiting.has(message.id)) {
          const id = waiting.get(message.id)!;
          waiting.delete(message.id);
          tell(typeof message.error === "string" ? { id, error: { message: message.error } } : { id, result: message.result ?? {} });
        }
      },
      () => {
        line = undefined;
        gone ??= "the browser went away";
        for (const id of waiting.values()) tell({ id, error: { message: gone } });
        waiting.clear();
        for (const asked of asking.values()) asked.reject(new Error(gone));
        asking.clear();
        if (!tab) refused?.(new Error(gone));
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err) => reject(new Error(`could not listen for the browser on port ${options.port ?? PORT}: ${err.message}`)));
    server.listen(options.port ?? PORT, "127.0.0.1", resolve);
  });
  options.listening?.();

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no tab was offered in time; the person offers one from the Praecise Control extension")), options.waitMs ?? 300_000);
      offered = () => {
        clearTimeout(timer);
        resolve();
      };
      refused = (reason) => {
        clearTimeout(timer);
        reject(reason);
      };
    });
  } catch (err) {
    server.close();
    throw err;
  }

  let next = 1;

  if (page) {
    // The extension is the screen: it is asked what a helper is asked, and answers the same way.
    const helper: Helper = {
      call: (method, params = {}) =>
        new Promise((resolve, reject) => {
          if (gone || !line) return reject(new Error(gone ?? "the browser went away"));
          const id = next++;
          asking.set(id, { resolve, reject });
          line.say(JSON.stringify({ id, method, params }));
        }),
      close: () => {
        line?.end();
        server.close();
      },
    };
    return {
      ...appScreen(helper, "tab", page, ["activate", "fill"]),
      open: async (url: string) => void (await helper.call("open", { url })),
      close: async () => helper.close(),
    };
  }

  /** The harness's browser screen speaks to a browser. This answers as the one tab. */
  class Tab {
    private readonly heard = new Map<string, Listener[]>();
    private readonly listener: Listener = (event) => this.emit("message", event);
    constructor(_url: string) {
      sockets.add(this.listener);
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(type: string, listener: Listener): void {
      this.heard.set(type, [...(this.heard.get(type) ?? []), listener]);
    }
    private emit(type: string, event: { data?: unknown }): void {
      for (const listener of this.heard.get(type) ?? []) listener(event);
    }
    send(data: string): void {
      const asked = JSON.parse(data) as { id: number; method: string; params?: Record<string, unknown> };
      const answer = (message: Record<string, unknown>): void => queueMicrotask(() => this.emit("message", { data: JSON.stringify({ id: asked.id, ...message }) }));
      if (asked.method === "Target.getTargets") return answer({ result: { targetInfos: [{ targetId: String(tab!.id), type: "page" }] } });
      if (asked.method === "Target.attachToTarget") return answer({ result: { sessionId: "tab" } });
      if (gone || !line) return answer({ error: { message: gone ?? "the browser went away" } });
      const id = next++;
      waiting.set(id, asked.id);
      line.say(JSON.stringify({ id, method: asked.method, params: asked.params ?? {} }));
    }
    close(): void {
      sockets.delete(this.listener);
      line?.end();
      server.close();
    }
  }

  return browserScreen({ endpoint: "the offered tab", fit: false, WebSocket: Tab });
}

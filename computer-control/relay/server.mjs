#!/usr/bin/env node
// Praecise Control's public route: an assistant somewhere else reaching the apps a
// person allowed on a computer of theirs.
//
// Nothing is opened on the person's computer. The computer connects out to this relay
// and stays connected; an assistant calls this relay; the relay passes each request to
// that computer and the answer back. It keeps nothing: no request, no answer and no
// picture is written anywhere here, and when the computer disconnects there is nothing
// left of it.
//
// Who may do what is decided by the Praecise account, not here. An assistant has a
// token the person gave it on a consent page, for one computer the person picked there.
// The computer has a token of the person's own. This relay checks both against the
// account service's keys, and passes nothing between two different people.
//
//   CONTROL_ADDRESS              this relay's public address, e.g. https://control.praecise.com
//   CONTROL_ISSUER               the account service; https://accounts.praecise.com unless said
//   CONTROL_CLAIMS_HOOK_SECRET   shared with the account service, for the question it asks here
//   PORT                         8080 unless said
//
// It needs nothing installed beside Node.

import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { createServer } from "node:http";

const ADDRESS = (process.env.CONTROL_ADDRESS ?? "").replace(/\/+$/, "");
const ISSUER = (process.env.CONTROL_ISSUER ?? "https://accounts.praecise.com").replace(/\/+$/, "");
const SECRET = process.env.CONTROL_CLAIMS_HOOK_SECRET ?? "";
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8080;
if (!ADDRESS) throw new Error("CONTROL_ADDRESS is this relay's public address and is not set");

/** How long an assistant waits for a computer to answer one request. */
const PATIENCE = 90_000;
/** The largest request an assistant may send. An answer may be larger: it can carry a picture. */
const LARGEST = 1_000_000;

const b64 = (text) => Buffer.from(text, "base64url");
const json = (text) => JSON.parse(Buffer.from(text, "base64url").toString("utf8"));

// The account service's keys, fetched when a token names one that is not known.

let keys = new Map();
let fetched = 0;
async function keyFor(kid) {
  if (!keys.has(kid) && Date.now() - fetched > 30_000) {
    fetched = Date.now();
    const response = await fetch(`${ISSUER}/jwks`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) keys = new Map((await response.json()).keys.map((each) => [each.kid, each]));
  }
  return keys.get(kid);
}

const HASH = { ES256: "sha256", RS256: "sha256", PS256: "sha256", EdDSA: null };

function signed(alg, jwk, data, signature) {
  if (!(alg in HASH)) return false;
  const key = createPublicKey({ key: jwk, format: "jwk" });
  if (alg === "ES256") return verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature);
  if (alg === "PS256") return verify("sha256", data, { key, padding: 6, saltLength: 32 }, signature);
  return verify(HASH[alg], data, key, signature);
}

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** A token of the account service's, for this relay, that has not run out. What it says is returned. */
async function tokenOf(request, scope) {
  const sent = String(request.headers.authorization ?? "");
  const [kind, token] = sent.split(" ");
  if (!token || !/^(bearer|dpop)$/i.test(kind)) throw new Refused(401, "a token is needed");
  return checked(token, scope, /^dpop$/i.test(kind) ? request : undefined, request);
}

async function checked(token, scope, proofFrom, request) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Refused(401, "that is not a token of the account service's");
  let head, said;
  try {
    head = json(parts[0]);
    said = json(parts[1]);
  } catch {
    throw new Refused(401, "that is not a token of the account service's");
  }
  const jwk = head.typ === "at+jwt" && typeof head.kid === "string" ? await keyFor(head.kid) : undefined;
  if (!jwk || !signed(head.alg, jwk, Buffer.from(`${parts[0]}.${parts[1]}`), b64(parts[2]))) throw new Refused(401, "the token was not signed by the account service");
  const audiences = Array.isArray(said.aud) ? said.aud : [said.aud];
  if (said.iss !== ISSUER || !audiences.includes(ADDRESS)) throw new Refused(401, "the token is not for this service");
  if (!(typeof said.exp === "number" && said.exp * 1000 > Date.now())) throw new Refused(401, "the token has run out");
  if (typeof said.sub !== "string" || !said.sub) throw new Refused(401, "the token names no person");
  if (!String(said.scope ?? "").split(" ").includes(scope)) throw new Refused(403, `the token does not allow ${scope}`);
  // A token bound to a key is only good with a proof made by that key, for this very request.
  if (said.cnf?.jkt) {
    if (!request) throw new Refused(401, "a token bound to a key cannot be used here");
    proof(request, token, said.cnf.jkt);
  } else if (proofFrom) throw new Refused(401, "the token is not bound to a key");
  return said;
}

function proof(request, token, thumbprint) {
  const sent = request.headers.dpop;
  if (typeof sent !== "string") throw new Refused(401, "the token is bound to a key, and no proof came with it");
  const parts = sent.split(".");
  let head, said;
  try {
    head = json(parts[0]);
    said = json(parts[1]);
  } catch {
    throw new Refused(401, "the proof cannot be read");
  }
  const jwk = head.jwk;
  if (head.typ !== "dpop+jwt" || !jwk || jwk.d !== undefined || !["ES256", "EdDSA"].includes(head.alg)) throw new Refused(401, "the proof is not one");
  // The key's name is a hash of its public parts in a fixed order (RFC 7638).
  const canonical = jwk.kty === "EC" ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y } : jwk.kty === "OKP" ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x } : undefined;
  if (!canonical || createHash("sha256").update(JSON.stringify(canonical)).digest("base64url") !== thumbprint) throw new Refused(401, "the proof was made by another key");
  if (!signed(head.alg, jwk, Buffer.from(`${parts[0]}.${parts[1]}`), b64(parts[2]))) throw new Refused(401, "the proof is not signed by its key");
  const here = `${ADDRESS}${new URL(request.url, ADDRESS).pathname}`;
  if (said.htm !== request.method || said.htu !== here) throw new Refused(401, "the proof is for another request");
  if (!(typeof said.iat === "number" && Math.abs(Date.now() / 1000 - said.iat) < 300)) throw new Refused(401, "the proof is too old");
  if (said.ath !== createHash("sha256").update(token).digest("base64url")) throw new Refused(401, "the proof is for another token");
}

// The computers connected now, by the person each belongs to.

/** What a request is answered with when the computer it was sent to goes away before answering. */
const GONE = Symbol("gone");

/** @type {Map<string, Map<string, {name: string, say(text: string): void, end(): void, waiting: Map<number, (reply: unknown) => void>, since: number}>>} */
const people = new Map();
let asked = 0;

function frames(socket, heard, closed) {
  let held = Buffer.alloc(0);
  let pieces = [];
  const write = (opcode, payload) => {
    const length = payload.length;
    const head = length < 126 ? Buffer.from([0x80 | opcode, length]) : length < 65_536 ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff]) : Buffer.alloc(10);
    if (length >= 65_536) {
      head[0] = 0x80 | opcode;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([head, payload]));
  };
  socket.on("data", (chunk) => {
    held = Buffer.concat([held, chunk]);
    for (;;) {
      if (held.length < 2) return;
      const opcode = held[0] & 0x0f;
      const final = (held[0] & 0x80) !== 0;
      const masked = (held[1] & 0x80) !== 0;
      let length = held[1] & 0x7f;
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
      if (masked) for (let nth = 0; nth < payload.length; nth++) payload[nth] ^= held[at + (nth % 4)];
      held = held.subarray(start + length);
      if (opcode === 8) return socket.end();
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
  // The other end has finished. This end finishes too, at once, and does not wait to find out by writing.
  socket.on("end", () => socket.end());
  // Said now and then, so that nothing between here and the computer takes a quiet line for a dead one.
  const alive = setInterval(() => write(9, Buffer.alloc(0)), 25_000);
  socket.on("close", () => clearInterval(alive));
  return { say: (text) => write(1, Buffer.from(text, "utf8")), end: () => socket.end() };
}

function host(request, socket) {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") return socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")}\r\n\r\n`);
  let mine;
  let person;
  let machine;
  // Nothing is known of it until it says who it is, and it is given a moment to.
  const patience = setTimeout(() => line.end(), 15_000);
  const line = frames(
    socket,
    async (text) => {
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (!mine) {
        clearTimeout(patience);
        try {
          if (message.type !== "hello" || !/^[A-Za-z0-9_-]{8,64}$/.test(String(message.machine ?? ""))) throw new Refused(400, "the first thing said is who this computer is");
          const said = await checked(String(message.token ?? ""), "control:host");
          person = said.sub;
          machine = message.machine;
          const computers = people.get(person) ?? new Map();
          people.set(person, computers);
          // The same computer connecting again takes the place of its earlier connection.
          computers.get(machine)?.end();
          mine = { name: String(message.name ?? "A computer").slice(0, 80), say: line.say, end: line.end, waiting: new Map(), since: Date.now() };
          computers.set(machine, mine);
          line.say(JSON.stringify({ type: "welcome" }));
        } catch (err) {
          line.say(JSON.stringify({ type: "refused", reason: err.message }));
          line.end();
        }
        return;
      }
      if (typeof message.id === "number" && mine.waiting.has(message.id)) {
        const answer = mine.waiting.get(message.id);
        mine.waiting.delete(message.id);
        answer(message.reply);
      }
    },
    () => {
      clearTimeout(patience);
      if (!mine) return;
      const computers = people.get(person);
      if (computers?.get(machine) === mine) computers.delete(machine);
      if (computers && !computers.size) people.delete(person);
      // Whoever was waiting on it is told it has gone, not left to think nothing was asked.
      for (const answer of mine.waiting.values()) answer(GONE);
    },
  );
}

/** What the account service asks before it gives a token for this relay, and each time it renews one. */
function hook(body, signature) {
  const [, t] = /(?:^|,)t=(\d+)/.exec(signature ?? "") ?? [];
  const [, v1] = /(?:^|,)v1=([0-9a-f]+)/.exec(signature ?? "") ?? [];
  const expected = createHmac("sha256", SECRET).update(`${t}.${body}`).digest();
  if (!SECRET || !t || !v1 || Math.abs(Date.now() - Number(t)) > 300_000 || v1.length !== 64 || !timingSafeEqual(expected, Buffer.from(v1, "hex"))) throw new Refused(401, "that did not come from the account service");
  const put = JSON.parse(body);
  const person = put.account?.id;
  if (!person) return { error: "access_denied", error_description: "Praecise Control is used by a person, for their own computers." };
  // A computer of the person's own, connecting itself.
  if (put.scopes?.includes("control:host")) {
    if (put.scopes.includes("control:use")) return { error: "access_denied", error_description: "A computer connects itself, or an assistant uses one. Not both with one permission." };
    return { claims: {}, scopes: ["control:host"], label: "This computer" };
  }
  const computers = people.get(person) ?? new Map();
  const chosen = put.requested?.control_machine;
  // One that was chosen before stays chosen, connected just now or not: a renewal is not the time to forget it.
  if (typeof chosen === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(chosen)) {
    return { claims: { control_machine: chosen }, scopes: ["control:use"], label: computers.get(chosen)?.name ?? "Your computer", requested: { control_machine: chosen } };
  }
  if (!computers.size) return { error: "access_denied", error_description: "No computer of yours is connected to Praecise Control. On the computer, start Praecise Control's public route, then try again." };
  return { choices: [...computers].map(([id, each]) => ({ label: each.name, detail: "Connected now", requested: { control_machine: id } })) };
}

const server = createServer((request, response) => {
  const say = (status, body, more = {}) => response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...more }).end(body === undefined ? "" : JSON.stringify(body));
  const path = new URL(request.url ?? "/", ADDRESS).pathname;
  const metadata = `${ADDRESS}/.well-known/oauth-protected-resource`;

  if (request.method === "GET" && path === "/healthz") return say(200, { ok: true });
  if (request.method === "GET" && (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")) {
    return say(200, { resource: ADDRESS, authorization_servers: [ISSUER], scopes_supported: ["control:use"], bearer_methods_supported: ["header"], resource_name: "Praecise Control" });
  }
  // How the program on a person's computer says what it is to the account service.
  if (request.method === "GET" && path === "/oauth/client.json") {
    return say(200, { client_id: `${ADDRESS}/oauth/client.json`, client_name: "Praecise Control on your computer", redirect_uris: ["http://127.0.0.1/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" });
  }

  let body = "";
  let large = false;
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > LARGEST) large = true;
  });
  request.on("end", async () => {
    try {
      if (large) throw new Refused(413, "that request is too large");
      if (request.method === "POST" && path === "/oauth/claims") return say(200, hook(body, String(request.headers["praecise-signature"] ?? "")));
      if (path !== "/mcp") throw new Refused(404, "the address is /mcp");
      if (request.method !== "POST") return say(405, { error: "requests are POSTed; nothing is pushed" }, { allow: "POST" });
      const said = await tokenOf(request, "control:use");
      const machine = said.control_machine;
      if (typeof machine !== "string") throw new Refused(403, "the token names no computer");
      const computer = people.get(said.sub)?.get(machine);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        return say(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "that is not JSON" } });
      }
      // Said as the protocol says a failure, so that the assistant can tell its person why.
      const failed = (each) => ({ jsonrpc: "2.0", id: each?.id ?? null, error: { code: -32001, message: "The computer is not connected to Praecise Control just now. Its person starts the public route on it." } });
      const absent = () => say(200, Array.isArray(message) ? message.filter((each) => each?.id !== undefined).map(failed) : failed(message));
      if (!computer) return absent();
      const id = ++asked;
      const reply = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          computer.waiting.delete(id);
          resolve(null);
        }, PATIENCE);
        computer.waiting.set(id, (answer) => {
          clearTimeout(timer);
          resolve(answer);
        });
        computer.say(JSON.stringify({ id, message, client: said.client_id }));
      });
      if (reply === GONE) return absent();
      if (reply === null) return say(504, { error: "the computer did not answer in time" });
      if (reply === undefined) return say(202);
      return say(200, reply);
    } catch (err) {
      if (!(err instanceof Refused)) return say(500, { error: "something went wrong here" });
      say(err.status, { error: err.message }, err.status === 401 ? { "www-authenticate": `Bearer resource_metadata="${metadata}"` } : {});
    }
  });
});
server.on("upgrade", (request, socket) => {
  if (new URL(request.url ?? "/", ADDRESS).pathname !== "/host") return socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
  host(request, socket);
});
server.listen(PORT, process.env.HOST ?? "127.0.0.1", () => process.stderr.write(`praecise-control-relay: ${ADDRESS}, checking tokens of ${ISSUER}, on port ${PORT}\n`));

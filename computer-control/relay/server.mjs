#!/usr/bin/env node
// Praecise Control's public route: an assistant somewhere else reaching the apps a
// person allowed on a computer of theirs.
//
// Nothing is opened on the person's computer. The computer connects out to this relay
// and stays connected; an assistant calls this relay; the relay passes each request to
// that computer and the answer back. No request, no answer and no picture is written
// anywhere here.
//
// Who may do what is decided by the Praecise account. An assistant or an app has a
// token the person gave it on a consent page: for the computers named in it, for what
// the token allows on them (see, act, record), and until a time if one was set. The
// computer has a token of the person's own. This relay checks both against the account
// service's keys, and passes nothing between two different people.
//
// What it keeps is a person's list of computers (the name, the kind of system, when
// each was last connected), what the person narrowed or withdrew for an app on one, and
// the latest things asked of each computer: which tool, on which app, by which app and
// when. Never what was read, typed or pictured.
// A person sees and changes that list here, with a token that allows managing it.
//
//   CONTROL_ADDRESS              this relay's public address, e.g. https://control.praecise.com
//   CONTROL_ISSUER               the account service; https://accounts.praecise.com unless said
//   CONTROL_CLAIMS_HOOK_SECRET   shared with the account service, for the question it asks here
//   CONTROL_DOWNLOADS_BY_APP     where an app's own edition is got, as JSON: {"<client id>": "<address>"}
//   CONTROL_EDITION_CLIENTS      what an edition's program is called when it signs a person in, as JSON: {"<edition>": "<name>"}
//   CONTROL_DATA                 the folder the list of computers is kept in; a folder in HOME unless said
//   PORT                         8080 unless said
//
// It needs nothing installed beside Node.

import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const ADDRESS = (process.env.CONTROL_ADDRESS ?? "").replace(/\/+$/, "");
const ISSUER = (process.env.CONTROL_ISSUER ?? "https://accounts.praecise.com").replace(/\/+$/, "");
const SECRET = process.env.CONTROL_CLAIMS_HOOK_SECRET ?? "";
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8080;
// Without its address or its secret it starts, says so, and passes nothing: it is put in place first and told these after.
const READY = Boolean(ADDRESS && SECRET);

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
  const has = String(said.scope ?? "").split(" ");
  const any = Array.isArray(scope) ? scope : [scope];
  if (!any.some((each) => has.includes(each))) throw new Refused(403, `the token does not allow ${any.length === 1 ? any[0] : "this"}`);
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

/** @type {Map<string, Map<string, {name: string, say(text: string): void, end(): void, waiting: Map<number, (reply: unknown) => void>, since: number, using?: {app: string, at: number}}>>} */
const people = new Map();
let asked = 0;

// What is kept: each person's computers, and what they narrowed or withdrew for an app on one.

const DATA = process.env.CONTROL_DATA ?? (process.env.HOME ? join(process.env.HOME, "praecise-control-relay") : "");
const ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Where a person gets Praecise Control for a computer. */
const GET = process.env.CONTROL_DOWNLOADS ?? "https://control.praecise.com/#download";
/** What each edition's program is called on the page where a person signs it in. */
const EDITION_CLIENTS = (() => {
  try {
    return JSON.parse(process.env.CONTROL_EDITION_CLIENTS ?? "{}");
  } catch {
    return {};
  }
})();
/** The same, for an app that has an edition of its own to send its people to: {"<client id>": "<address>"}. */
const GET_FOR = (() => {
  try {
    return JSON.parse(process.env.CONTROL_DOWNLOADS_BY_APP ?? "{}");
  } catch {
    return {};
  }
})();

/** How many of the latest things done on one computer are kept for its person to read. */
const RECORD = 200;

/** @type {Record<string, {activity?: Record<string, Array<{at: number, app: string, by: string | null, did: string, on: string | null}>>, devices: Record<string, {name: string, named?: boolean, system: string, first: number, last: number, removed?: boolean}>, limits: Record<string, Record<string, {inputs?: string[], until?: number, off?: boolean}>>}>} */
let kept = {};
try {
  if (DATA) kept = JSON.parse(readFileSync(join(DATA, "computers.json"), "utf8"));
} catch {
  kept = {};
}
let saving;
function save() {
  if (!DATA || saving) return;
  saving = setTimeout(() => {
    saving = undefined;
    try {
      mkdirSync(DATA, { recursive: true, mode: 0o700 });
      writeFileSync(join(DATA, "computers.json.new"), JSON.stringify(kept), { mode: 0o600 });
      renameSync(join(DATA, "computers.json.new"), join(DATA, "computers.json"));
    } catch (err) {
      process.stderr.write(`praecise-control-relay: the list of computers could not be written: ${err.message}\n`);
    }
  }, 200);
}
const of = (person) => (kept[person] ??= { devices: {}, limits: {} });

/** Writes down what was asked of a computer: which tool and action, on which app, by whom. Never what was read, typed or pictured. */
function note(person, device, app, by, message) {
  const record = of(person);
  const list = ((record.activity ??= {})[device] ??= []);
  for (const each of Array.isArray(message) ? message : [message]) {
    if (each?.method !== "tools/call") continue;
    const [, tool] = /computer_control_([a-z]+)$/.exec(String(each.params?.name ?? "")) ?? [];
    const action = each.params?.arguments?.action;
    const on = each.params?.arguments?.app ?? each.params?.arguments?.account;
    list.push({ at: Math.floor(Date.now() / 1000), app, by, did: `${tool ?? "unknown"}${typeof action === "string" ? `:${action.slice(0, 40)}` : ""}`, on: typeof on === "string" ? on.slice(0, 80) : null });
  }
  if (list.length > RECORD) list.splice(0, list.length - RECORD);
  save();
}

// What a token may allow on a computer, and which of those a request needs.

/** Each thing that can be allowed on a computer, by the permission that allows it. */
const INPUTS = { "control:screen": "screen", "control:act": "act", "control:record": "record", "control:files": "files", "control:code": "code", "control:camera": "camera", "control:microphone": "microphone" };
/** What the older single permission allows: the apps' windows, and no more. */
const WINDOWS = ["screen", "act", "record"];
/** Permissions a token for an assistant or an app may carry. */
const USES = ["control:use", ...Object.keys(INPUTS)];
const LISTS = ["control:devices", "control:manage"];

/** What a token's permissions allow: the older single permission allows all three. */
function inputsOf(scope) {
  const has = String(scope ?? "").split(" ");
  return new Set([...(has.includes("control:use") ? WINDOWS : []), ...has.filter((each) => each in INPUTS).map((each) => INPUTS[each])]);
}

const LOOKS = { elements: ["read", "read_page", "find", "text", "get_page_text"], screen: ["screenshot", "zoom", "cursor_position", "wait"] };

/** What one request needs allowed. Asking what there is needs nothing; a tool that is not known needs everything. */
function needs(message) {
  const all = new Set();
  for (const each of Array.isArray(message) ? message : [message]) {
    if (each?.method !== "tools/call") continue;
    const [, tool] = /computer_control_([a-z]+)$/.exec(String(each.params?.name ?? "")) ?? [];
    const action = String(each.params?.arguments?.action ?? "");
    if (tool === "accounts") all.add("screen");
    else if (tool === "record") all.add("record");
    else if (tool === "open") all.add("act");
    else if (tool === "files" || tool === "code" || tool === "camera" || tool === "microphone") all.add(tool);
    else if (tool in LOOKS) all.add(LOOKS[tool].includes(action) ? "screen" : "act");
    else for (const input of Object.values(INPUTS)) all.add(input);
  }
  return all;
}

/** The computers a token names. */
const named = (said) => [...new Set([...String(said.control_devices ?? "").split(/[ .,]+/), said.control_machine].filter((each) => typeof each === "string" && ID.test(each)))];

/** What an app may do on one computer now: what its token allows, less what the person narrowed or withdrew there. */
function allowed(said, device) {
  const record = kept[said.sub];
  if (record?.devices[device]?.removed) throw new Refused(403, "that computer was removed from Praecise Control by its person");
  if (record?.devices[device]?.paused) throw new Refused(403, "that computer is paused by its person");
  const limit = record?.limits[device]?.[said.client_id];
  if (limit?.off) throw new Refused(403, "this app's use of that computer was withdrawn by its person");
  const until = Math.min(Number(said.control_until) > 0 ? Number(said.control_until) : Infinity, limit?.until ?? Infinity);
  if (until * 1000 < Date.now()) throw new Refused(403, "the time this app was allowed on that computer has passed");
  const inputs = inputsOf(said.scope);
  return { inputs: limit?.inputs ? new Set(limit.inputs.filter((each) => inputs.has(each))) : inputs, until: Number.isFinite(until) ? until : null };
}

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
          if (message.type !== "hello" || !ID.test(String(message.machine ?? ""))) throw new Refused(400, "the first thing said is who this computer is");
          const said = await checked(String(message.token ?? ""), "control:host");
          person = said.sub;
          machine = message.machine;
          const record = of(person);
          if (record.devices[machine]?.removed) throw new Refused(403, "this computer was removed from Praecise Control; its person restores it where they manage their computers");
          const now = Math.floor(Date.now() / 1000);
          const was = record.devices[machine];
          const called = String(message.name ?? "A computer").slice(0, 80);
          record.devices[machine] = { name: was?.named ? was.name : called, ...(was?.named ? { named: true } : {}), system: ["macos", "windows", "linux"].includes(message.system) ? message.system : "unknown", edition: /^[a-z0-9-]{1,24}$/.test(String(message.edition ?? "")) ? message.edition : "praecise", first: was?.first ?? now, last: now };
          save();
          const computers = people.get(person) ?? new Map();
          people.set(person, computers);
          // The same computer connecting again takes the place of its earlier connection.
          computers.get(machine)?.end();
          mine = { name: record.devices[machine].name, say: line.say, end: line.end, waiting: new Map(), since: Date.now() };
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
      if (computers?.get(machine) === mine) {
        computers.delete(machine);
        const record = kept[person]?.devices[machine];
        if (record) {
          record.last = Math.floor(Date.now() / 1000);
          save();
        }
      }
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
  const wanted = Array.isArray(put.scopes) ? put.scopes : [];
  // A computer of the person's own, connecting itself.
  if (wanted.includes("control:host")) {
    if (wanted.some((each) => each !== "control:host" && each.startsWith("control:"))) return { error: "access_denied", error_description: "A computer connects itself, or an assistant uses one. Not both with one permission." };
    return { claims: {}, scopes: ["control:host"], label: "This computer" };
  }
  const uses = wanted.filter((each) => USES.includes(each));
  const lists = wanted.filter((each) => LISTS.includes(each));
  // Only the list of computers, to read or to manage: no computer is opened by it.
  if (!uses.length) {
    if (!lists.length) return { error: "access_denied", error_description: "Nothing of Praecise Control was asked for." };
    return { claims: {}, scopes: lists, label: lists.includes("control:manage") ? "Your list of computers, to manage" : "The names of your computers" };
  }
  const record = of(person);
  const computers = people.get(person) ?? new Map();
  const known = (id) => Boolean(record.devices[id] && !record.devices[id].removed);
  const asked = put.requested ?? {};
  const said = typeof asked.control_devices === "string" ? asked.control_devices.split(/[ .,]+/) : typeof asked.control_machine === "string" ? [asked.control_machine] : [];
  const ids = [...new Set(said.filter((each) => ID.test(each)))].slice(0, 16);
  if (!ids.length) {
    // Nothing was named: the person picks one of theirs, those connected now first.
    const theirs = Object.entries(record.devices).filter(([id]) => known(id) && !record.limits[id]?.[put.client_id]?.off).sort(([a], [b]) => Number(computers.has(b)) - Number(computers.has(a))).slice(0, 12);
    if (!theirs.length) return { error: "access_denied", error_description: "No computer of yours is connected to Praecise Control. On the computer, start Praecise Control's public route, then try again." };
    return { choices: theirs.map(([id, each]) => ({ label: each.name, detail: computers.has(id) ? "Connected now" : "Not connected just now", requested: { control_machine: id } })) };
  }
  // A computer the person removed, or withdrew this app from, drops out; a renewal is asked this too.
  const still = ids.filter((id) => known(id) && !record.limits[id]?.[put.client_id]?.off);
  if (!still.length) return { error: "access_denied", error_description: "None of those computers is yours to allow, or this app's use of them was withdrawn." };
  const claims = { control_devices: still.join(".") };
  const requested = { control_devices: still.join(".") };
  if (still.length === 1) claims.control_machine = still[0];
  if (asked.control_until !== undefined) {
    const until = /^\d{9,11}$/.test(String(asked.control_until)) ? Number(asked.control_until) : Math.floor(Date.parse(String(asked.control_until)) / 1000);
    if (!(until * 1000 > Date.now())) return { error: "access_denied", error_description: "The time this was allowed for has passed. Allow it again to carry on." };
    claims.control_until = String(until);
    requested.control_until = String(until);
  }
  const names = still.map((id) => record.devices[id].name).join(", ");
  return { claims, scopes: [...uses, ...lists], label: names.length > 118 ? `${still.length} of your computers` : names, requested };
}

/** A person's computers, as they are shown to that person or to an app they allowed. */
function listed(said) {
  const record = kept[said.sub] ?? { devices: {}, limits: {} };
  const computers = people.get(said.sub) ?? new Map();
  const has = String(said.scope ?? "").split(" ");
  const manages = has.includes("control:manage");
  const all = manages || has.includes("control:devices");
  const mine = named(said);
  const now = Date.now();
  const out = [];
  for (const [id, each] of Object.entries(record.devices)) {
    if (each.removed && !manages) continue;
    if (!all && !mine.includes(id)) continue;
    const live = computers.get(id);
    const one = { id, name: each.name, system: each.system, edition: each.edition ?? "praecise", connected: Boolean(live), first_connected: each.first, last_connected: live ? Math.floor(now / 1000) : each.last };
    if (each.removed) one.removed = true;
    if (each.paused) one.paused = true;
    const busy = live?.using && now - live.using.at < 30_000 ? live.using : undefined;
    // What this app may do there. A computer it was not allowed is listed by name only.
    if (mine.includes(id) && inputsOf(said.scope).size) {
      try {
        const may = allowed(said, id);
        one.allowed = [...may.inputs];
        one.until = may.until;
      } catch {
        one.allowed = [];
        one.until = null;
      }
      one.in_use = Boolean(busy && busy.app === said.client_id);
    }
    if (manages) {
      one.in_use_by = busy ? busy.app : null;
      one.apps = Object.entries(record.limits[id] ?? {}).map(([app, limit]) => ({ app, withdrawn: limit.off === true, only: limit.inputs ?? null, until: limit.until ?? null }));
    }
    out.push(one);
  }
  // With none yet, an app has somewhere to send its person: where Praecise Control is got for a computer.
  return { devices: out, inputs: Object.values(INPUTS), get: typeof GET_FOR[said.client_id] === "string" ? GET_FOR[said.client_id] : GET };
}

/** A person changing their list: a name, removing or restoring a computer, narrowing or withdrawing an app on one. */
function manage(said, method, parts, body) {
  const record = of(said.sub);
  const id = parts[0];
  const device = record.devices[id];
  if (!device) throw new Refused(404, "that is not a computer of yours");
  let put = {};
  if (body) {
    try {
      put = JSON.parse(body);
    } catch {
      throw new Refused(400, "that is not JSON");
    }
  }
  if (parts.length === 2 && parts[1] === "activity") {
    if (method !== "GET") throw new Refused(405, "what was done is read with GET");
    return { activity: [...(record.activity?.[id] ?? [])].reverse() };
  }
  if (parts.length === 1) {
    if (method === "DELETE") put = { removed: true };
    else if (method !== "PATCH") throw new Refused(405, "a computer is changed with PATCH or removed with DELETE");
    if (put.name !== undefined) {
      const name = String(put.name).replace(/\s+/g, " ").trim().slice(0, 80);
      if (!name) throw new Refused(400, "a name has something in it");
      device.name = name;
      device.named = true;
      const live = people.get(said.sub)?.get(id);
      if (live) live.name = name;
    }
    // Paused, a computer stays connected and listed, and every app is refused until it is resumed.
    if (put.paused === true) device.paused = true;
    else if (put.paused === false) delete device.paused;
    if (put.removed === true) {
      device.removed = true;
      people.get(said.sub)?.get(id)?.end();
    } else if (put.removed === false) delete device.removed;
  } else if (parts.length === 3 && parts[1] === "apps" && parts[2]) {
    const limits = (record.limits[id] ??= {});
    if (method === "DELETE") limits[parts[2]] = { off: true };
    else if (method === "PUT") {
      const limit = {};
      if (put.withdrawn === true) limit.off = true;
      if (put.only !== undefined && put.only !== null) {
        if (!Array.isArray(put.only) || put.only.some((each) => !Object.values(INPUTS).includes(each))) throw new Refused(400, `only is a list of: ${Object.values(INPUTS).join(", ")}`);
        limit.inputs = [...new Set(put.only)];
      }
      if (put.until !== undefined && put.until !== null) {
        if (!(Number(put.until) * 1000 > Date.now())) throw new Refused(400, "until is a time to come, in seconds");
        limit.until = Math.floor(Number(put.until));
      }
      if (Object.keys(limit).length) limits[parts[2]] = limit;
      else delete limits[parts[2]];
    } else throw new Refused(405, "an app on a computer is set with PUT or withdrawn with DELETE");
  } else throw new Refused(404, "there is nothing at that address");
  save();
  return listed(said);
}

const server = createServer((request, response) => {
  const say = (status, body, more = {}) => response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...more }).end(body === undefined ? "" : JSON.stringify(body));
  const path = new URL(request.url ?? "/", ADDRESS || "http://unset").pathname;
  const metadata = `${ADDRESS}/.well-known/oauth-protected-resource`;

  if (request.method === "GET" && path === "/healthz") return say(200, { ok: true, ready: READY });
  if (request.method === "GET" && path === "/") return say(200, { name: "Praecise Control", mcp: `${ADDRESS}/mcp`, about: "The public route to the apps a person allowed on a computer of theirs. An assistant is let in by that person, with their Praecise account." });
  if (!READY) return say(503, { error: "this relay has not been given its address and its secret yet" });
  if (request.method === "GET" && (path === "/.well-known/oauth-protected-resource" || path.startsWith("/.well-known/oauth-protected-resource/"))) {
    return say(200, { resource: ADDRESS, authorization_servers: [ISSUER], scopes_supported: [...USES, ...LISTS], bearer_methods_supported: ["header"], dpop_signing_alg_values_supported: ["ES256", "EdDSA"], resource_name: "Praecise Control" });
  }
  // The same, for an edition that carries another name: the person is asked by that name.
  const [, named] = /^\/oauth\/clients\/([a-z0-9-]{1,24})\.json$/.exec(path) ?? [];
  if (request.method === "GET" && named) {
    if (typeof EDITION_CLIENTS[named] !== "string") return say(404, { error: "there is no such edition" });
    return say(200, { client_id: `${ADDRESS}${path}`, client_name: EDITION_CLIENTS[named].slice(0, 80), redirect_uris: ["http://127.0.0.1/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" });
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
      // A person's computers: listed for them or an app they allowed, changed by them.
      if (path === "/devices" || path.startsWith("/devices/")) {
        const parts = path.split("/").slice(2).filter(Boolean).map((each) => decodeURIComponent(each));
        if (!parts.length) {
          if (request.method !== "GET") return say(405, { error: "the list is read with GET" }, { allow: "GET" });
          return say(200, listed(await tokenOf(request, [...USES, ...LISTS])));
        }
        return say(200, manage(await tokenOf(request, "control:manage"), request.method, parts, body));
      }
      if (path !== "/mcp" && !path.startsWith("/mcp/")) throw new Refused(404, "the address is /mcp");
      if (request.method !== "POST") return say(405, { error: "requests are POSTed; nothing is pushed" }, { allow: "POST" });
      const said = await tokenOf(request, USES);
      const theirs = named(said);
      if (!theirs.length) throw new Refused(403, "the token names no computer");
      // Which computer: in the address or a header, or the only one the token names.
      const picked = path.startsWith("/mcp/") ? decodeURIComponent(path.slice(5)) : typeof request.headers["praecise-control-device"] === "string" ? request.headers["praecise-control-device"] : theirs.length === 1 ? theirs[0] : undefined;
      if (!picked) throw new Refused(400, `this token is for ${theirs.length} computers; say which at /mcp/<id>, with an id from /devices`);
      if (!theirs.includes(picked)) throw new Refused(403, "the token is not for that computer");
      const machine = picked;
      const may = allowed(said, machine);
      // An app may hold one of its own helpers to less than it was allowed, and say which helper is asking.
      const only = request.headers["praecise-control-only"];
      if (typeof only === "string") may.inputs = new Set(only.split(/[ ,]+/).filter((each) => may.inputs.has(each)));
      const by = typeof request.headers["praecise-control-actor"] === "string" ? request.headers["praecise-control-actor"].replace(/[^\x20-\x7e]/g, "").slice(0, 80) || null : null;
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
      // Held to what was allowed there, before anything reaches the computer.
      const lacking = [...needs(message)].filter((each) => !may.inputs.has(each));
      if (lacking.length) {
        const refused = (each) => ({ jsonrpc: "2.0", id: each?.id ?? null, error: { code: -32002, message: `This was not allowed on that computer: ${lacking.join(", ")}. Its person allows it with their Praecise account.`, data: { needs: lacking } } });
        return say(200, Array.isArray(message) ? message.filter((each) => each?.id !== undefined).map(refused) : refused(message));
      }
      if (!computer) return absent();
      computer.using = { app: String(said.client_id ?? ""), at: Date.now() };
      note(said.sub, machine, String(said.client_id ?? ""), by, message);
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
        computer.say(JSON.stringify({ id, message, client: said.client_id, ...(by ? { actor: by } : {}) }));
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
  if (!READY || new URL(request.url ?? "/", ADDRESS).pathname !== "/host") return socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
  host(request, socket);
});
server.listen(PORT, process.env.HOST ?? "127.0.0.1", () => process.stderr.write(READY ? `praecise-control-relay: ${ADDRESS}, checking tokens of ${ISSUER}, on port ${PORT}\n` : `praecise-control-relay: on port ${PORT}, passing nothing until CONTROL_ADDRESS and CONTROL_CLAIMS_HOOK_SECRET are set\n`));

// Praecise Control's public route, whole: a stand-in for the account service, the real
// relay, the real program on a computer (with a stand-in helper behind it), and an
// assistant calling from outside.
//
//   PRAECISE_TEST_CONTROL_APP=/folder/with/praecise.config.ts   set up and connected, with an app named mail
//   node --test tests/control-relay.test.ts
//
// What is not tried here is the person signing in: the computer is handed its token.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = process.env.PRAECISE_TEST_CONTROL_APP;
const RELAY = fileURLToPath(new URL("../computer-control/relay/server.mjs", import.meta.url));
const FRONT = fileURLToPath(new URL("../computer-control/mcp.mjs", import.meta.url));
const SECRET = "a-secret-shared-with-the-account-service-for-this-test";

const listening = (server: ReturnType<typeof createServer>): Promise<number> => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
const b64 = (value: unknown): string => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

test("an assistant elsewhere reaches a person's computer through the relay, and only that person's", { skip: !APP }, async (t) => {
  // The account service, as far as the relay asks it anything: its keys.
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const account = createServer((request, response) => {
    if (request.url === "/jwks") return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig" }] }));
    response.writeHead(404).end();
  });
  const issuer = `http://127.0.0.1:${await listening(account)}`;
  const spare = createServer();
  const port = await listening(spare);
  await new Promise((resolve) => spare.close(resolve));
  const address = `http://127.0.0.1:${port}`;

  const token = (claims: Record<string, unknown>, key = privateKey): string => {
    const head = b64({ alg: "ES256", typ: "at+jwt", kid: "k1" });
    const body = b64({ iss: issuer, aud: address, exp: Math.floor(Date.now() / 1000) + 600, client_id: "https://assistant.example/client.json", ...claims });
    return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };

  const started = (command: string, args: string[], env: Record<string, string>, ready: string) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
    t.after(() => child.kill());
    return new Promise<typeof child>((resolve, reject) => {
      let said = "";
      child.stderr.on("data", (chunk) => {
        said += String(chunk);
        if (said.includes(ready)) resolve(child);
      });
      child.on("exit", () => reject(new Error(`${command} stopped: ${said.slice(-400)}`)));
    });
  };
  t.after(() => account.close());

  const data = mkdtempSync(join(tmpdir(), "control-relay-test-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  await started(process.execPath, [RELAY], { CONTROL_ADDRESS: address, CONTROL_ISSUER: issuer, CONTROL_CLAIMS_HOOK_SECRET: SECRET, CONTROL_DATA: data, PORT: String(port) }, "praecise-control-relay");

  /** An answer whose body is read once, and which says what was asked when there is nothing in it. */
  const answered = async (response: Response, asked: unknown) => {
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      json: async (): Promise<unknown> => {
        assert.ok(text, `an empty answer, status ${response.status}, to ${JSON.stringify(asked).slice(0, 160)}`);
        return JSON.parse(text);
      },
    };
  };
  const mcp = async (bearer: string | undefined, body: unknown, more: Record<string, string> = {}, at = "/mcp") =>
    answered(await fetch(`${address}${at}`, { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...more }, body: JSON.stringify(body) }), body);
  const hook = async (body: Record<string, unknown>, secret = SECRET) => {
    const raw = JSON.stringify(body);
    const at = Date.now();
    const response = await fetch(`${address}/oauth/claims`, { method: "POST", headers: { "content-type": "application/json", "praecise-signature": `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${raw}`).digest("hex")}` }, body: raw });
    return { status: response.status, said: (await response.json()) as Record<string, any> };
  };
  const alice = { id: "alice", email: "alice@example.com", email_verified: true };

  // What it says of itself.
  const about = (await (await fetch(`${address}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
  assert.deepEqual([about.resource, about.authorization_servers, about.scopes_supported], [address, [issuer], ["control:use", "control:screen", "control:act", "control:record", "control:files", "control:code", "control:camera", "control:microphone", "control:devices", "control:manage"]]);
  assert.equal(((await (await fetch(`${address}/oauth/client.json`)).json()) as { client_id: string }).client_id, `${address}/oauth/client.json`);

  // Nobody gets in without a token of the account service's, for this relay, that allows it.
  const none = await mcp(undefined, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(none.status, 401);
  assert.equal(none.headers.get("www-authenticate"), `Bearer resource_metadata="${address}/.well-known/oauth-protected-resource"`);
  assert.equal((await mcp(token({ sub: "alice", scope: "control:use", control_machine: "m".repeat(12), aud: "https://another.example" }), {})).status, 401);
  assert.equal((await mcp(token({ sub: "alice", scope: "control:use", control_machine: "m".repeat(12), exp: 1 }), {})).status, 401);
  assert.equal((await mcp(token({ sub: "alice", scope: "control:use", control_machine: "m".repeat(12) }, generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey), {})).status, 401);
  assert.equal((await mcp(token({ sub: "alice", scope: "control:host" }), {})).status, 403);
  assert.equal((await mcp(token({ sub: "alice", scope: "control:use" }), {})).status, 403);
  assert.equal((await mcp(token({ sub: "alice", scope: "control:use", control_machine: "m".repeat(12), cnf: { jkt: "x" } }), {})).status, 401);

  // The question the account service asks, which only it may ask.
  assert.equal((await hook({ account: alice, scopes: ["control:use"], resource: address, requested: {} }, "not the secret")).status, 401);
  assert.match((await hook({ account: alice, scopes: ["control:use"], resource: address, requested: {} })).said.error_description, /No computer of yours is connected/);
  assert.deepEqual((await hook({ account: alice, scopes: ["control:host"], resource: address, requested: {} })).said, { claims: {}, scopes: ["control:host"], label: "This computer" });
  assert.equal((await hook({ account: null, scopes: ["control:use"], resource: address, requested: {} })).said.error, "access_denied");

  // Alice's computer connects itself, with a token of her own.
  const computer = await started(process.execPath, [FRONT, APP!, "--cloud", address], { PRAECISE_CONTROL_CLOUD_TOKEN: token({ sub: "alice", scope: "control:host" }) }, "this computer is reachable");
  const machine = readFileSync(`${APP}/.praecise/control-machine`, "utf8").trim();

  // On the consent page she is shown her computers and picks one; that choice goes in the assistant's token.
  const choices = (await hook({ account: alice, scopes: ["control:use"], resource: address, requested: {} })).said.choices as { label: string; requested: { control_machine: string } }[];
  assert.equal(choices.length, 1);
  assert.equal(choices[0]!.requested.control_machine, machine);
  assert.deepEqual((await hook({ account: alice, scopes: ["control:use", "control:host"], resource: address, requested: choices[0]!.requested })).said.error, "access_denied");
  const granted = (await hook({ account: alice, scopes: ["control:use"], resource: address, requested: choices[0]!.requested })).said;
  assert.deepEqual([granted.claims, granted.scopes], [{ control_devices: machine, control_machine: machine }, ["control:use"]]);
  assert.match((await hook({ account: { ...alice, id: "bob" }, scopes: ["control:use"], resource: address, requested: {} })).said.error_description, /No computer of yours/);

  // The assistant, from outside, with the token Alice gave it.
  const hers = token({ sub: "alice", scope: "control:use", control_machine: machine });
  const opened = (await (await mcp(hers, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "assistant", version: "1" } } })).json()) as { result: { serverInfo: { name: string } } };
  assert.equal(opened.result.serverInfo.name, "praecise-control");
  assert.equal((await mcp(hers, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const listed = (await (await mcp(hers, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as { result: { tools: { name: string }[] } };
  assert.ok(listed.result.tools.some((each) => each.name === "computer_control_elements"));
  const found = (await (await mcp(hers, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "computer_control_elements", arguments: { app: "mail", action: "find", query: "send" } } })).json()) as { result: { content: { text: string }[] } };
  assert.equal(found.result.content[0]!.text, 'button "Send" [e3]');
  const shot = (await (await mcp(hers, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "computer_control_screen", arguments: { app: "mail", action: "screenshot" } } })).json()) as { result: { content: { type: string }[] } };
  assert.ok(shot.result.content.some((each) => each.type === "image"));
  // The app still decides: a press that sends is refused in a mode that does not allow it.
  const press = (await (await mcp(hers, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "computer_control_elements", arguments: { app: "mail", action: "click", ref: "e3" } } })).json()) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(press.result.isError, true);

  // A token bound to a key works with a proof made by that key for this request, and not without one.
  const bound = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = bound.publicKey.export({ format: "jwk" }) as { crv: string; kty: string; x: string; y: string };
  const tied = token({ sub: "alice", scope: "control:use", control_machine: machine, cnf: { jkt: createHash("sha256").update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest("base64url") } });
  const proof = (htu: string): string => {
    const head = b64({ alg: "ES256", typ: "dpop+jwt", jwk });
    const body = b64({ htm: "POST", htu, iat: Math.floor(Date.now() / 1000), jti: String(Math.random()), ath: createHash("sha256").update(tied).digest("base64url") });
    return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key: bound.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const asDpop = async (headers: Record<string, string>) =>
    answered(await fetch(`${address}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `DPoP ${tied}`, ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "ping" }) }), "ping with a proof");
  assert.equal((await asDpop({})).status, 401);
  assert.equal((await asDpop({ dpop: proof(`${address}/elsewhere`) })).status, 401);
  assert.deepEqual(((await (await asDpop({ dpop: proof(`${address}/mcp`) })).json()) as { result: unknown }).result, {});

  // Another person's token does not reach Alice's computer, whatever computer it names.
  const his = (await (await mcp(token({ sub: "bob", scope: "control:use", control_machine: machine }), { jsonrpc: "2.0", id: 7, method: "tools/list" })).json()) as { error: { message: string } };
  assert.match(his.error.message, /not connected/);

  // An app she allowed to see only: it reads, and is refused a press before anything reaches the computer.
  const app = "https://app.example/client.json";
  const call = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const sees = token({ sub: "alice", scope: "control:screen control:devices", control_devices: machine, client_id: app });
  const read = (await (await mcp(sees, call(20, "computer_control_elements", { app: "mail", action: "find", query: "send" }))).json()) as { result: { content: { text: string }[] } };
  assert.equal(read.result.content[0]!.text, 'button "Send" [e3]');
  const pressed = (await (await mcp(sees, call(21, "computer_control_elements", { app: "mail", action: "click", ref: "e3" }))).json()) as { error: { code: number; data: { needs: string[] } } };
  assert.deepEqual([pressed.error.code, pressed.error.data.needs], [-32002, ["act"]]);
  const taped = (await (await mcp(sees, call(22, "computer_control_record", { app: "mail", action: "start" }))).json()) as { error: { data: { needs: string[] } } };
  assert.deepEqual(taped.error.data.needs, ["record"]);
  // The app may hold a helper of its own to less, name it, and say which computer in the address.
  const narrowed = (await (await mcp(hers, call(23, "computer_control_elements", { app: "mail", action: "click", ref: "e3" }), { "praecise-control-only": "screen", "praecise-control-actor": "helper-one" }, `/mcp/${machine}`)).json()) as { error: { data: { needs: string[] } } };
  assert.deepEqual(narrowed.error.data.needs, ["act"]);
  assert.equal((await mcp(hers, { jsonrpc: "2.0", id: 24, method: "ping" }, {}, `/mcp/${"z".repeat(12)}`)).status, 403);
  // Files, a coding agent, the camera and the microphone are each allowed by name, and not by the older permission.
  assert.deepEqual(((await (await mcp(hers, call(30, "computer_control_files", { folder: "work", action: "list" }))).json()) as { error: { data: { needs: string[] } } }).error.data.needs, ["files"]);
  assert.deepEqual(((await (await mcp(sees, call(31, "computer_control_code", { workspace: "work-code", action: "list" }))).json()) as { error: { data: { needs: string[] } } }).error.data.needs, ["code"]);
  const films = token({ sub: "alice", scope: "control:camera", control_devices: machine, client_id: app });
  assert.deepEqual(((await (await mcp(films, call(32, "computer_control_microphone", { microphone: "microphone" }))).json()) as { error: { data: { needs: string[] } } }).error.data.needs, ["microphone"]);
  // With the permission it reaches the computer, which has no camera turned on and says so itself.
  assert.ok(((await (await mcp(films, call(33, "computer_control_camera", { camera: "camera" }))).json()) as { error?: { code: number }; result?: unknown }).error?.code !== -32002);
  // Paused by its person, the computer refuses every app until resumed.
  const pauses = token({ sub: "alice", scope: "control:manage" });
  const set = (body: unknown) => fetch(`${address}/devices/${machine}`, { method: "PATCH", headers: { authorization: `Bearer ${pauses}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(((await (await set({ paused: true })).json()) as { devices: { paused?: boolean }[] }).devices[0]!.paused, true);
  assert.equal((await mcp(hers, { jsonrpc: "2.0", id: 34, method: "ping" })).status, 403);
  assert.equal(((await (await set({ paused: false })).json()) as { devices: { paused?: boolean }[] }).devices[0]!.paused, undefined);
  assert.equal((await mcp(hers, { jsonrpc: "2.0", id: 35, method: "ping" })).status, 200);

  // A time that has passed ends it.
  assert.equal((await mcp(token({ sub: "alice", scope: "control:use", control_devices: machine, control_until: String(Math.floor(Date.now() / 1000) - 5) }), { jsonrpc: "2.0", id: 25, method: "ping" })).status, 403);
  assert.equal((await hook({ account: alice, client_id: app, scopes: ["control:screen"], resource: address, requested: { control_devices: machine, control_until: "1000000000" } })).said.error, "access_denied");
  const timed = (await hook({ account: alice, client_id: app, scopes: ["control:screen", "control:act"], resource: address, requested: { control_devices: `${machine}.${"q".repeat(12)}`, control_until: String(Math.floor(Date.now() / 1000) + 3600) } })).said;
  assert.deepEqual([timed.claims.control_devices, timed.scopes, typeof timed.claims.control_until], [machine, ["control:screen", "control:act"], "string"]);
  assert.deepEqual((await hook({ account: alice, client_id: app, scopes: ["control:devices"], resource: address, requested: {} })).said.scopes, ["control:devices"]);

  // The list: an app sees her computers and what it may do on each; she sees which apps, and what was done.
  const get = async (bearer: string, at: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${address}${at}`, { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, said: (await response.json()) as Record<string, any> };
  };
  await mcp(sees, call(36, "computer_control_elements", { app: "mail", action: "find", query: "send" }));
  const seen = (await get(sees, "/devices")).said.devices as Record<string, any>[];
  assert.deepEqual([seen.length, seen[0]!.id, seen[0]!.connected, seen[0]!.allowed, seen[0]!.in_use], [1, machine, true, ["screen"], true]);
  assert.equal((await get(sees, `/devices/${machine}`, "PATCH", { name: "Not hers to name" })).status, 403);
  assert.equal((await get(token({ sub: "bob", scope: "control:devices" }), "/devices")).said.devices.length, 0);
  const manages = token({ sub: "alice", scope: "control:manage" });
  assert.equal((await get(manages, `/devices/${machine}`, "PATCH", { name: "The desk Mac" })).said.devices[0].name, "The desk Mac");
  const done = (await get(manages, `/devices/${machine}/activity`)).said.activity as { app: string; by: string | null; did: string; on: string }[];
  assert.ok(done.some((each) => each.app === app && each.did === "elements:find" && each.on === "mail"));
  assert.ok(!done.some((each) => each.app === app && each.did === "elements:click"), "what was refused here never reached the computer and is not written as done");
  // She narrows the app on that computer, then withdraws it; both hold at once, and at the next renewal.
  const at = `/devices/${machine}/apps/${encodeURIComponent(app)}`;
  const acts = token({ sub: "alice", scope: "control:screen control:act", control_devices: machine, client_id: app });
  assert.deepEqual((await get(manages, at, "PUT", { only: ["screen"] })).said.devices[0].apps, [{ app, withdrawn: false, only: ["screen"], until: null }]);
  assert.deepEqual(((await (await mcp(acts, call(26, "computer_control_open", { app: "mail" }))).json()) as { error: { data: { needs: string[] } } }).error.data.needs, ["act"]);
  assert.equal((await get(manages, at, "DELETE")).status, 200);
  assert.equal((await mcp(acts, { jsonrpc: "2.0", id: 27, method: "ping" })).status, 403);
  assert.equal((await hook({ account: alice, client_id: app, scopes: ["control:screen"], resource: address, requested: { control_devices: machine } })).said.error, "access_denied");
  assert.equal((await mcp(hers, { jsonrpc: "2.0", id: 28, method: "ping" })).status, 200, "another app she allowed is not touched by it");

  // When her computer stops, there is nothing left to reach.
  computer.kill();
  await new Promise((resolve) => computer.on("exit", resolve));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const gone = (await (await mcp(hers, { jsonrpc: "2.0", id: 8, method: "tools/list" })).json()) as { error: { message: string } };
  assert.match(gone.error.message, /not connected/);
  // It is still hers, and still listed: she may allow an app on it before it is back.
  const later = (await hook({ account: alice, scopes: ["control:use"], resource: address, requested: {} })).said.choices as { label: string; detail: string }[];
  assert.deepEqual([later[0]!.label, later[0]!.detail], ["The desk Mac", "Not connected just now"]);
  assert.equal((await get(manages, "/devices")).said.devices[0].connected, false);
  // Removed, it is refused to every app and not offered again until she restores it.
  assert.equal((await get(manages, `/devices/${machine}`, "DELETE")).said.devices[0].removed, true);
  assert.equal((await mcp(hers, { jsonrpc: "2.0", id: 29, method: "ping" })).status, 403);
  assert.match((await hook({ account: alice, scopes: ["control:use"], resource: address, requested: {} })).said.error_description, /No computer of yours/);
  // And it is written down, a moment after, so that a new start of the relay does not forget it.
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(JSON.parse(readFileSync(join(data, "computers.json"), "utf8")).alice.devices[machine].removed, true);
});

// The Meta Platforms marketing environment against a stand-in for Meta: the sign-in,
// the accounts it finds, what each of Meta's tools is taken to do, and deliveries.
//
//   node --test tests/

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { metaMarketing } from "../meta-marketing/index.ts";

const GRAPH = "https://graph.facebook.com/v26.0/";

/** Meta, as far as this environment asks it anything. */
const meta = (): { fetch: typeof fetch; asked: string[] } => {
  const asked: string[] = [];
  const lists: Record<string, unknown[]> = {
    "me/businesses": [{ id: "b1", name: "Acme" }],
    "me/adaccounts": [{ id: "act_9", name: "EU Store", currency: "EUR", business: { id: "b1" } }],
    "me/accounts": [{ id: "p7", name: "Acme Page", instagram_business_account: { id: "ig3", username: "acme" } }],
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(`${new Headers(init?.headers).get("authorization") ?? "-"} ${url}`);
    if (url.startsWith("https://graph.facebook.com/v27.0/oauth/access_token")) {
      return Response.json({ access_token: "meta-token", expires_in: 5_184_000 });
    }
    const path = url.startsWith(GRAPH) ? url.slice(GRAPH.length).split("?")[0]! : "";
    return path in lists ? Response.json({ data: lists[path] }) : Response.json({ error: { message: "unknown" } }, { status: 400 });
  }) as typeof fetch;
  return { fetch: fetchImpl, asked };
};

const signIn = async (address: string): Promise<void> => {
  const url = new URL(address);
  const back = new URL(url.searchParams.get("redirect_uri")!);
  back.searchParams.set("code", "code");
  back.searchParams.set("state", url.searchParams.get("state")!);
  await fetch(back);
};

const vault = (): { kind: string; get(id: string): Promise<string | undefined>; put(id: string, secret: string): Promise<void>; delete(id: string): Promise<void> } => {
  const held = new Map<string, string>();
  return { kind: "memory", get: async (id) => held.get(id), put: async (id, secret) => void held.set(id, secret), delete: async (id) => void held.delete(id) };
};

const connected = async (): Promise<{ environment: ReturnType<typeof metaMarketing>; asked: string[]; root: string }> => {
  const root = await mkdtemp(join(tmpdir(), "meta-marketing-"));
  const there = meta();
  const environment = metaMarketing({ appId: "1234567890", callbackPort: 0, vault: vault() });
  environment.use({ root, fetch: there.fetch, env: { META_APP_SECRET: "app-secret", META_WEBHOOK_VERIFY_TOKEN: "agreed" } });
  let page = "";
  await environment.connect({ open: async (address) => ((page = address), signIn(address)) });
  await environment.sync();
  there.asked.unshift(page);
  return { environment, asked: there.asked, root };
};

test("signs in with Meta as a public client and asks only for what a reading install needs", async () => {
  const { asked, root } = await connected();
  const page = new URL(asked[0]!);
  assert.equal(page.origin + page.pathname, "https://www.facebook.com/v27.0/dialog/oauth");
  assert.equal(page.searchParams.get("client_id"), "1234567890");
  assert.equal(page.searchParams.get("code_challenge_method"), "S256");
  assert.equal(page.searchParams.get("scope"), "ads_mcp_management ads_read business_management pages_show_list instagram_basic");
  assert.ok(!asked.join("\n").includes("client_secret"));
  await rm(root, { recursive: true, force: true });
});

test("finds businesses, ad accounts, Pages and Instagram accounts, by name, in read mode", async () => {
  const { environment, asked, root } = await connected();
  const accounts = await environment.accounts();
  assert.deepEqual(
    accounts.map((each) => [each.alias, each.kind, each.mode]),
    [
      ["acme", "business", "read"],
      ["acme-page", "page", "read"],
      ["acme/eu-store", "ad_account", "read"],
      ["acme-page/acme", "instagram_account", "read"],
    ],
  );
  assert.ok(asked.some((line) => line.startsWith("Bearer meta-token https://graph.facebook.com/v26.0/me/adaccounts")));
  // A reading install was not granted WhatsApp, so it is not asked about.
  assert.ok(!asked.some((line) => line.includes("whatsapp")));
  await rm(root, { recursive: true, force: true });
});

test("takes every listed tool of Meta's servers to read, draft, publish, send or destroy", async () => {
  const { environment, root } = await connected();
  const { ads, whatsapp, developer, instagram } = environment.spec.resources!;
  assert.equal(ads!.classes!.ads_get_ad_entities, "read");
  assert.equal(ads!.classes!.ads_create_campaign, "draft");
  assert.equal(ads!.classes!.ads_activate_entity, "publish");
  assert.equal(ads!.classes!.ads_delete_custom_audience, "destroy");
  assert.equal(whatsapp!.classes!.whatsapp_biz_send_message, "send");
  assert.equal(developer!.classes!.devtools_app_create, "publish");
  // Nothing is known of the Instagram server's tools yet, so all of them need a person.
  assert.equal(instagram!.classes, undefined);
  await rm(root, { recursive: true, force: true });
});

test("refuses a change through Meta's servers that names no account", async () => {
  const { environment, root } = await connected();
  const call = environment.app!.functions!.meta_marketing_call!;
  const args = { server: "ads", tool: "ads_activate_entity", arguments: "{}" };
  const verdict = await environment.authority!.check({ agent: "app", tool: "meta_marketing_call", origin: "local", args, action: call.action!(args) });
  assert.match((verdict as { refuse: string }).refuse, /names no account/);
  const reading = { server: "ads", tool: "ads_get_ad_accounts", arguments: "{}" };
  assert.deepEqual(await environment.authority!.check({ agent: "app", tool: "meta_marketing_call", origin: "local", args: reading, action: call.action!(reading) }), { allow: true });
  await rm(root, { recursive: true, force: true });
});

test("takes a delivery Meta signed, and no other", async () => {
  const { environment, root } = await connected();
  const body = JSON.stringify({ object: "page", entry: [{ id: "p7", time: 1, changes: [{ field: "feed", value: { message: "hello" } }] }] });
  const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
  const published: unknown[] = [];
  const publish = async (type: string, data?: unknown, rest?: unknown): Promise<[]> => (published.push({ type, data, rest }), []);

  const forged = await environment.receive(new Request("https://app.example/in", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=00" } }), publish);
  assert.equal(forged.status, 401);
  assert.equal(published.length, 0);

  const genuine = await environment.receive(new Request("https://app.example/in", { method: "POST", body, headers: { "x-hub-signature-256": signature } }), publish);
  assert.equal(genuine.status, 200);
  assert.deepEqual(published, [{ type: "meta-marketing.page.feed", data: { message: "hello" }, rest: { subject: "acme-page", id: "meta-marketing:p7:1:feed:0" } }]);

  const check = await environment.receive(new Request("https://app.example/in?hub.mode=subscribe&hub.verify_token=agreed&hub.challenge=42"), publish);
  assert.equal(await check.text(), "42");
  const stranger = await environment.receive(new Request("https://app.example/in?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=42"), publish);
  assert.equal(stranger.status, 403);
  await rm(root, { recursive: true, force: true });
});

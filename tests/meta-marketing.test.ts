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
const meta = (enrolled = true): { fetch: typeof fetch; asked: string[] } => {
  const asked: string[] = [];
  const lists: Record<string, unknown[]> = {
    "me/businesses": [{ id: "b1", name: "Acme" }],
    "me/adaccounts": [{ id: "act_9", name: "EU Store", currency: "EUR", business: { id: "b1" } }],
    "me/accounts": [{ id: "p7", name: "Acme Page", instagram_business_account: { id: "ig3", username: "acme" } }],
    "b1/owned_whatsapp_business_accounts": [{ id: "w5", name: "Acme WhatsApp" }],
    "w5/phone_numbers": [{ id: "n8", display_phone_number: "+1 555 0100", verified_name: "Acme Support" }],
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(`${new Headers(init?.headers).get("authorization") ?? "-"} ${init?.method ?? "GET"} ${url} ${String(init?.body ?? "").replace(/access_token=[^&]*/, "access_token=x")}`.trim());
    if (url.startsWith("https://ads-api.facebook.com/")) {
      return enrolled ? Response.json({ data: [] }) : Response.json({ error: { message: "not available", code: 10 } }, { status: 400 });
    }
    if (url === `${GRAPH}p7?fields=access_token`) return Response.json({ access_token: "page-token" });
    if (url === `${GRAPH}p7/feed` && init?.method === "POST") return Response.json({ id: "p7_1" });
    if (url === `${GRAPH}ig3/media` && init?.method === "POST") return Response.json({ id: "container-1" });
    if (url === `${GRAPH}ig3/media_publish`) return Response.json({ id: "media-1" });
    if (url === `${GRAPH}container-1?fields=status_code`) return Response.json({ status_code: "FINISHED" });
    if (url === `${GRAPH}p7_55` || url === `${GRAPH}17900000001`) return Response.json({ success: true });
    if (url.startsWith(`${GRAPH}p7/conversations?platform=instagram`)) return Response.json({ data: [{ id: "t_1", participants: { data: [{ id: "77000001" }] } }] });
    if (url === `${GRAPH}p7/messages`) return Response.json({ recipient_id: "77000001", message_id: "m1" });
    if (url === "https://graph.threads.com/oauth/access_token") return Response.json({ access_token: "th-short", user_id: 1 });
    if (url.startsWith("https://graph.threads.com/access_token?")) return Response.json({ access_token: "th-long", expires_in: 5_183_944 });
    if (url === "https://graph.threads.com/v1.0/me?fields=id,username") return Response.json({ id: "th9000001", username: "acme" });
    if (url === "https://graph.threads.com/v1.0/th9000001/threads") return Response.json({ id: "tc1" });
    if (url === "https://graph.threads.com/v1.0/th9000001/threads_publish") return Response.json({ id: "tm1" });
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

const connected = async (
  options: Partial<Parameters<typeof metaMarketing>[0]> = {},
  enrolled = true,
): Promise<{ environment: ReturnType<typeof metaMarketing>; asked: string[]; root: string }> => {
  const root = await mkdtemp(join(tmpdir(), "meta-marketing-"));
  const there = meta(enrolled);
  const environment = metaMarketing({ appId: "1234567890", callbackPort: 0, vault: vault(), ...options });
  environment.use({ root, fetch: there.fetch, env: { META_APP_SECRET: "app-secret", META_WEBHOOK_VERIFY_TOKEN: "agreed", THREADS_APP_SECRET: "threads-secret" } });
  let page = "";
  await environment.connect({ open: async (address) => ((page ||= address), there.asked.push(`page ${new URL(address).origin}${new URL(address).pathname}`), signIn(address)) });
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
  assert.ok(asked.some((line) => line.startsWith("Bearer meta-token GET https://graph.facebook.com/v26.0/me/adaccounts")));
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

test("publishes to a Page and to Instagram as the Page, once the account allows it and a person agrees", async () => {
  const { environment, asked, root } = await connected({ organic: true, profile: "act" });
  assert.ok(new URL(asked[0]!).searchParams.get("scope")!.includes("pages_manage_posts"));
  const post = environment.app!.functions!.meta_page_post!;
  const args = { page: "acme-page", message: "hello" };
  await assert.rejects(Promise.resolve().then(() => post.run(args, {})), /read mode/);
  const numbers = await environment.accounts({ kind: "whatsapp_number" });
  assert.deepEqual(numbers.map((each) => [each.alias, each.facts]), [["acme/acme-support", { number: "+1 555 0100" }]]);

  await environment.setMode("acme-page", "act");
  const verdict = await environment.authority!.check({ agent: "app", tool: "meta_page_post", origin: "local", args, action: post.action!(args) });
  assert.ok("stepUp" in verdict);
  assert.deepEqual(await post.run(args, {}), { id: "p7_1" });
  assert.ok(asked.some((line) => line.startsWith("Bearer page-token POST https://graph.facebook.com/v26.0/p7/feed message=hello")));

  await environment.setMode("acme-page/acme", "act");
  const published = await environment.app!.functions!.meta_instagram_publish!.run({ account: "acme-page/acme", image: "https://cdn.example/a.jpg" }, {});
  assert.deepEqual(published, { id: "media-1" });
  assert.ok(asked.some((line) => line.includes("ig3/media_publish creation_id=container-1")));
  await assert.rejects(Promise.resolve().then(() => environment.app!.functions!.meta_page_comments!.run({ page: "acme-page", post: "../me" }, {})), /is not a post/);
  await rm(root, { recursive: true, force: true });
});

test("holds an ad account to its mode and limits with Meta's own rules, where the business is enrolled", async () => {
  const { environment, asked, root } = await connected({ rules: true });
  await environment.setMode("acme/eu-store", "draft");
  const rules = asked.filter((line) => line.includes("ads-api.facebook.com/v25.0/marketing-api/businesses/b1/accounts/act_9/ads_mcp_rules"));
  assert.equal(rules.length, 4);
  assert.ok(rules[0]!.includes("action=all&trigger_type=always&status=paused"));
  assert.ok(rules[1]!.includes("action=edit_status&trigger_type=always&status=active"));

  await environment.setLimits("acme/eu-store", { perDay: 500 });
  const ceiling = asked.filter((line) => line.includes("trigger_type=absolute_max")).at(-1)!;
  assert.ok(ceiling.includes("status=active"));
  assert.ok(decodeURIComponent(ceiling).includes('"max_value_cents":50000'));
  await rm(root, { recursive: true, force: true });

  const outside = await connected({ rules: true }, false);
  await assert.rejects(outside.environment.setMode("acme/eu-store", "draft"), /has to be enrolled/);
  await rm(outside.root, { recursive: true, force: true });
});

test("signs in to one of Meta's servers by itself when asked to", async () => {
  const { environment, asked, root } = await connected({ separate: ["whatsapp"] });
  const whatsapp = environment.spec.resources!.whatsapp!;
  assert.equal(whatsapp.separate, true);
  assert.deepEqual(whatsapp.scopes, ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"]);
  assert.equal(asked.filter((line) => line.includes("/oauth/access_token")).length, 2);
  await rm(root, { recursive: true, force: true });
});

const run = (environment: ReturnType<typeof metaMarketing>, name: string, args: Record<string, unknown>): Promise<unknown> =>
  Promise.resolve().then(() => environment.app!.functions![name]!.run(args, {}));

test("reads and answers conversations in Messenger and Instagram Direct, as the Page", async () => {
  const { environment, asked, root } = await connected({ messaging: true });
  assert.ok(new URL(asked[0]!).searchParams.get("scope")!.includes("pages_messaging instagram_manage_messages"));
  assert.deepEqual(await run(environment, "meta_conversations", { page: "acme-page", platform: "instagram" }), [{ id: "t_1", participants: { data: [{ id: "77000001" }] } }]);
  const sending = { page: "acme-page", to: "77000001", text: "On its way." };
  await assert.rejects(run(environment, "meta_message_send", sending), /read mode/);
  await environment.setMode("acme-page", "act");
  const send = environment.app!.functions!.meta_message_send!;
  assert.ok("stepUp" in (await environment.authority!.check({ agent: "app", tool: "meta_message_send", origin: "local", args: sending, action: send.action!(sending) })));
  assert.deepEqual(await run(environment, "meta_message_send", sending), { recipient_id: "77000001", message_id: "m1" });
  const sent = asked.find((line) => line.startsWith("Bearer page-token POST https://graph.facebook.com/v26.0/p7/messages"))!;
  assert.ok(sent.includes("messaging_type=RESPONSE"));
  assert.ok(decodeURIComponent(sent).includes('{"id":"77000001"}'));
  await assert.rejects(run(environment, "meta_messages", { page: "acme-page", conversation: "t_1/../me" }), /is not a conversation/);
  await rm(root, { recursive: true, force: true });
});

test("publishes a carousel and a reel, and hides or deletes a comment only with a person", async () => {
  const { environment, asked, root } = await connected({ organic: true, profile: "act" });
  await environment.setMode("acme-page/acme", "act");
  await environment.setMode("acme-page", "act");
  assert.deepEqual(await run(environment, "meta_instagram_publish", { account: "acme-page/acme", images: "https://cdn.example/a.jpg, https://cdn.example/b.jpg", caption: "Two" }), { id: "media-1" });
  assert.ok(asked.some((line) => line.includes("ig3/media media_type=CAROUSEL&children=container-1%2Ccontainer-1&caption=Two")));
  await assert.rejects(run(environment, "meta_instagram_publish", { account: "acme-page/acme", images: "https://cdn.example/a.jpg" }), /2 to 20/);

  assert.deepEqual(await run(environment, "meta_instagram_publish", { account: "acme-page/acme", video: "https://cdn.example/a.mp4" }), { id: "media-1" });
  assert.ok(asked.some((line) => line.includes("ig3/media media_type=REELS&video_url=")));
  assert.ok(asked.some((line) => line.includes("container-1?fields=status_code")));

  assert.deepEqual(await run(environment, "meta_page_comment_hide", { page: "acme-page", comment: "p7_55", hidden: "true" }), { success: true });
  assert.ok(asked.some((line) => line.includes("POST https://graph.facebook.com/v26.0/p7_55 is_hidden=true")));
  const removing = { account: "acme-page/acme", comment: "17900000001" };
  const remove = environment.app!.functions!.meta_instagram_comment_delete!;
  assert.ok("stepUp" in (await environment.authority!.check({ agent: "app", tool: "meta_instagram_comment_delete", origin: "local", args: removing, action: remove.action!(removing) })));
  assert.deepEqual(await run(environment, "meta_instagram_comment_delete", removing), { success: true });
  assert.ok(asked.some((line) => line.includes("DELETE https://graph.facebook.com/v26.0/17900000001")));
  await rm(root, { recursive: true, force: true });
});

test("signs in to Threads by itself, trades for a lasting token, and publishes to the profile it finds", async () => {
  const { environment, asked, root } = await connected({ threads: { appId: "threads-app", callbackPort: 0 } });
  assert.deepEqual(asked.filter((line) => line.startsWith("page ")), ["page https://www.facebook.com/v27.0/dialog/oauth", "page https://threads.com/oauth/authorize"]);
  assert.ok(asked.some((line) => line.includes("https://graph.threads.com/oauth/access_token") && line.includes("client_secret=threads-secret")));
  assert.ok(asked.some((line) => line.includes("grant_type=th_exchange_token")));
  const [profile] = await environment.accounts({ kind: "threads_profile" });
  assert.equal(profile!.alias, "acme-threads");

  const posting = { profile: "acme-threads", text: "hello" };
  await assert.rejects(run(environment, "meta_threads_publish", posting), /read mode/);
  await environment.setMode("acme-threads", "act");
  assert.deepEqual(await run(environment, "meta_threads_publish", posting), { id: "tm1" });
  assert.ok(asked.some((line) => line.startsWith("Bearer th-long POST https://graph.threads.com/v1.0/th9000001/threads media_type=TEXT&text=hello")));
  // Meta's own servers and its Graph API are still asked with Meta's token, not Threads'.
  assert.ok(asked.some((line) => line.startsWith("Bearer meta-token GET https://graph.facebook.com/v26.0/me/adaccounts")));
  await assert.rejects(run(environment, "meta_threads_publish", { profile: "acme-threads", text: "x".repeat(501) }), /500 characters/);
  await rm(root, { recursive: true, force: true });
});

test("launches a campaign as a draft and then one call that waits for a person", async () => {
  const { environment, root } = await connected();
  const launch = environment.app!.workflows!["meta-campaign-launch"] as { steps: { id: string; use?: string; with?: Record<string, string>; agent?: string }[] };
  assert.deepEqual(launch.steps.map((step) => step.id), ["draft", "activate"]);
  assert.equal(launch.steps[0]!.agent, "meta-campaign-drafter");
  assert.deepEqual(launch.steps[1]!.with, { server: "ads", tool: "ads_activate_entity", account: "{{account}}", arguments: "{{draft.activation}}" });

  // The call the second step makes: it names the account beside the tool's own arguments.
  const call = environment.app!.functions!.meta_marketing_call!;
  const args = { server: "ads", tool: "ads_activate_entity", account: "acme/eu-store", arguments: '{"entity_id":"120200000000001"}' };
  const asking = { agent: "app", tool: "meta_marketing_call", origin: "local" as const, args, action: call.action!(args) };
  assert.match(((await environment.authority!.check(asking)) as { refuse: string }).refuse, /read mode and this needs act/);
  await environment.setMode("acme/eu-store", "act");
  assert.ok("stepUp" in (await environment.authority!.check(asking)));
  await rm(root, { recursive: true, force: true });
});

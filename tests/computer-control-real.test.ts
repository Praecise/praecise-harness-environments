// The computer control environment through a real helper, against the small Orders app
// in tests/fixtures. It runs where a helper and the app are named:
//
//   PRAECISE_TEST_COMPUTER_HELPER='["/path/to/praecise-computer-helper"]'   the command, as JSON
//   PRAECISE_TEST_COMPUTER_APP=orders-gtk                                    the app's id
//   PRAECISE_TEST_COMPUTER_POINTER=1                                         also the pointer and keys by position
//
//   node --test tests/computer-control-real.test.ts

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { computerControl, helperProcess } from "../computer-control/index.ts";

const HELPER = process.env.PRAECISE_TEST_COMPUTER_HELPER;
const APP = process.env.PRAECISE_TEST_COMPUTER_APP ?? "";
const POINTER = process.env.PRAECISE_TEST_COMPUTER_POINTER === "1";

test("works a real app through a real helper", { skip: !HELPER || !APP }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "computer-control-real-"));
  const helper = helperProcess(JSON.parse(HELPER!) as string[]);
  const kept = new Map<string, string>();
  const environment = computerControl({
    apps: [APP],
    helper,
    vault: { kind: "memory", get: async (id) => kept.get(id), put: async (id, secret) => void kept.set(id, secret), delete: async (id) => void kept.delete(id) },
  });
  t.after(async () => {
    helper.close();
    await rm(root, { recursive: true, force: true });
  });
  environment.use({ root, env: {} });

  for (const check of await environment.doctor()) if (["helper", "permissions"].includes(check.name)) assert.equal(check.ok, true, `${check.name}: ${check.detail}`);
  await environment.connect();
  await environment.sync();
  const [account] = await environment.accounts();
  assert.ok(account, "the app was not found among what the helper lists");
  const app = account.alias;
  assert.equal(account.mode, "read");

  const run = (name: string, args: Record<string, unknown>) => Promise.resolve().then(() => environment.app!.functions![name]!.run({ app, ...args }, {}));
  const asked = (name: string, args: Record<string, unknown>) =>
    environment.authority!.check({ agent: "app", tool: name, origin: "local", args: { app, ...args }, action: environment.app!.functions![name]!.action!({ app, ...args }) });
  const refOf = (listed: string, what: RegExp): string => {
    const found = what.exec(listed);
    assert.ok(found, `${String(what)} is not in:\n${listed}`);
    return found[1]!;
  };

  const first = String(await run("computer_control_elements", { action: "read", filter: "interactive" }));
  const field = refOf(first, /textbox "Name" = "old"[^\n]*\[(\w+)\]/);
  const save = refOf(first, /button "Save"[^\n]*\[(\w+)\]/);
  const all = String(await run("computer_control_elements", { action: "read" }));
  assert.match(all, /^window "Orders" \[\w+\]/);
  assert.match(all, /text "Not saved\." \[\w+\]/);

  // Read mode: nothing is pressed.
  assert.match(((await asked("computer_control_elements", { action: "click", ref: save })) as { refuse: string }).refuse, /read mode/);
  await assert.rejects(run("computer_control_elements", { action: "click", ref: save }), /read mode/);

  await environment.setMode(app, "act");
  const filled = String(await run("computer_control_elements", { action: "fill", ref: field, value: "new name" }));
  assert.match(filled, /changed: textbox "Name" = "new name"/);

  // Nothing says Save is harmless, so it waits for a person.
  assert.ok("stepUp" in (await asked("computer_control_elements", { action: "click", ref: save })));
  const pressed = String(await run("computer_control_elements", { action: "click", ref: save }));
  assert.match(pressed, /^Clicked button "Save"/);
  assert.ok(pressed.includes(`gone: button "Save" [${save}]`), pressed);
  assert.match(String(await run("computer_control_elements", { action: "text" })), /Saved new name/);
  await assert.rejects(run("computer_control_elements", { action: "click", ref: save }), /no longer in the window/);

  const shot = (await run("computer_control_screen", { action: "screenshot" })) as Record<symbol, { mime: string; data: string }[]>;
  const [picture] = shot[Object.getOwnPropertySymbols(shot)[0]!]!;
  assert.equal(picture!.mime, "image/png");
  assert.equal(Buffer.from(picture!.data, "base64").subarray(1, 4).toString(), "PNG");

  if (!POINTER) return;
  const box = String(await run("computer_control_elements", { action: "find", query: "checkbox paid" }));
  const paid = refOf(box, /checkbox "Paid only"[^\n]*\[(\w+)\]/);
  assert.doesNotMatch(box, /\(.*checked.*\)/);
  const where = /in view at \[(\d+), (\d+)\]/.exec(String(await run("computer_control_elements", { action: "scroll_to", ref: paid })))!;
  await run("computer_control_screen", { action: "left_click", coordinate: [Number(where[1]), Number(where[2])] });
  const at = /in view at \[(\d+), (\d+)\]/.exec(String(await run("computer_control_elements", { action: "scroll_to", ref: field })))!;
  await run("computer_control_screen", { action: "left_click", coordinate: [Number(at[1]), Number(at[2])] });
  await run("computer_control_screen", { action: "key", text: "ctrl+a" });
  await run("computer_control_screen", { action: "type", text: "typed in" });
  await run("computer_control_screen", { action: "wait", duration: 0.5 });
  const after = String(await run("computer_control_elements", { action: "read", filter: "interactive" }));
  assert.match(after, /checkbox "Paid only" \([^)]*checked[^)]*\)/);
  assert.match(after, /textbox "Name" = "typed in"/);
});

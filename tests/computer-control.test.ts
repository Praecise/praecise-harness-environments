// The computer control environment against a stand-in for a helper: which apps are
// listed, what a window reads as, what each press is taken to be, and what waits for a
// person.
//
//   node --test tests/

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { computerControl, helperProcess, kindOfPress, type Helper } from "../computer-control/index.ts";

const HELPER = fileURLToPath(new URL("./fixtures/computer-helper.mjs", import.meta.url));

const vault = () => {
  const kept = new Map<string, string>();
  return {
    kind: "memory",
    get: async (id: string) => kept.get(id),
    put: async (id: string, secret: string) => void kept.set(id, secret),
    delete: async (id: string) => void kept.delete(id),
  };
};

const connected = async (t: { after(run: () => unknown): void }, flags: string[] = [], apps = ["Mail", "com.example.notes"]) => {
  const root = await mkdtemp(join(tmpdir(), "computer-control-"));
  const helper: Helper = helperProcess([process.execPath, HELPER, ...flags]);
  const environment = computerControl({ apps, helper, vault: vault() });
  t.after(async () => {
    helper.close();
    await rm(root, { recursive: true, force: true });
  });
  environment.use({ root, env: {} });
  await environment.connect();
  await environment.sync();
  const run = (name: string, args: Record<string, unknown>) => Promise.resolve().then(() => environment.app!.functions![name]!.run(args, {}));
  const asked = (name: string, args: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    environment.authority!.check({ agent: "app", tool: name, origin: "local", args, action: environment.app!.functions![name]!.action!(args), ...more });
  return { environment, helper, run, asked };
};

test("lists only the apps it was told of, each in read mode", async (t) => {
  const { environment } = await connected(t);
  assert.deepEqual(
    (await environment.accounts()).map((each) => [each.alias, each.kind, each.mode]),
    [
      ["mail", "app", "read"],
      ["notes", "app", "read"],
    ],
  );
});

test("reads a window as the things in it, in read mode", async (t) => {
  const { run, asked } = await connected(t);
  const reading = { app: "mail", action: "read", filter: "interactive" };
  assert.deepEqual(await asked("computer_control_elements", reading), { allow: true });
  assert.equal(
    await run("computer_control_elements", reading),
    [
      'textbox "To" [e1]',
      'textbox "Message" [e2]',
      'button "Send" [e3]',
      'button "Delete draft" [e4]',
      'button "Next" [e5]',
      'button "Pay now" [e6]',
      'checkbox "Sync over mobile data" [e7]',
    ].join("\n"),
  );
  assert.equal(await run("computer_control_elements", { app: "mail", action: "find", query: "send" }), 'button "Send" [e3]');
});

test("presses nothing in read mode, and an app it was not told of is not there", async (t) => {
  const { run, asked, helper } = await connected(t);
  await run("computer_control_elements", { app: "mail", action: "read" });
  const pressing = { app: "mail", action: "click", ref: "e5" };
  assert.match(((await asked("computer_control_elements", pressing)) as { refuse: string }).refuse, /mail is in read mode and this needs draft/);
  await assert.rejects(run("computer_control_elements", pressing), /read mode/);
  await assert.rejects(run("computer_control_elements", { app: "passwords", action: "read" }), /passwords/);
  assert.deepEqual(await helper.call("log"), []);
});

test("what a press is follows what is pressed", () => {
  assert.equal(kindOfPress("button", "Send"), "send");
  assert.equal(kindOfPress("link", "Delete account"), "destroy");
  assert.equal(kindOfPress("button", "Pay now"), "spend");
  assert.equal(kindOfPress("button", "Next"), "draft");
  // Clicking a field puts the caret in it, whatever the field is called.
  assert.equal(kindOfPress("textbox", "Message"), "draft");
  assert.equal(kindOfPress("textbox", "Reply"), "draft");
  assert.equal(kindOfPress("link", "Pricing"), "draft");
  // Not known to be harmless, so it needs a person.
  assert.equal(kindOfPress("checkbox", "Sync over mobile data"), "publish");
  assert.equal(kindOfPress("button", "Apply"), "publish");
  assert.equal(kindOfPress("button", undefined), "publish");
  assert.equal(kindOfPress(undefined, undefined), "publish");
  // A word inside another is not that word.
  assert.equal(kindOfPress("button", "Resend code"), "publish");
});

test("in draft mode it types and moves about, and what commits needs act", async (t) => {
  const { environment, run, asked, helper } = await connected(t);
  await environment.setMode("mail", "draft");
  await run("computer_control_elements", { app: "mail", action: "read" });

  assert.deepEqual(await asked("computer_control_elements", { app: "mail", action: "click", ref: "e5" }), { allow: true });
  assert.deepEqual(await asked("computer_control_elements", { app: "mail", action: "fill", ref: "e2", value: "Hello" }), { allow: true });
  assert.deepEqual(await asked("computer_control_screen", { app: "mail", action: "type", text: "Hello" }), { allow: true });
  assert.deepEqual(await asked("computer_control_screen", { app: "mail", action: "key", text: "shift+Tab" }), { allow: true });
  for (const [name, args] of [
    ["computer_control_elements", { app: "mail", action: "click", ref: "e3" }],
    ["computer_control_elements", { app: "mail", action: "click", ref: "e7" }],
    ["computer_control_screen", { app: "mail", action: "type", text: "Hello\n" }],
    ["computer_control_screen", { app: "mail", action: "key", text: "Return" }],
    ["computer_control_screen", { app: "mail", action: "key", text: "ctrl+s" }],
    ["computer_control_screen", { app: "mail", action: "left_click", coordinate: [20, 270] }],
  ] as const) {
    assert.match(((await asked(name, args)) as { refuse: string }).refuse, /draft mode and this needs act/, JSON.stringify(args));
  }

  assert.equal(await run("computer_control_elements", { app: "mail", action: "fill", ref: "e2", value: "Hello" }), "Filled [e2] with 5 character(s). Nothing that can be worked changed.");
  assert.match(String(await run("computer_control_elements", { app: "mail", action: "click", ref: "e5" })), /^Clicked button "Next" \[e5\]\./);
  assert.deepEqual(await helper.call("log"), [
    ["fill", "com.example.mail", "e2", "Hello"],
    ["click", "com.example.mail", { x: 210, y: 272 }, "left", 1, []],
  ]);
});

test("in act mode sending, removing and paying each wait for a person, and paying says how much", async (t) => {
  const { environment, run, asked } = await connected(t);
  await environment.setMode("mail", "act");
  await run("computer_control_elements", { app: "mail", action: "read" });

  assert.ok("stepUp" in (await asked("computer_control_elements", { app: "mail", action: "click", ref: "e3" })));
  assert.ok("stepUp" in (await asked("computer_control_elements", { app: "mail", action: "click", ref: "e4" })));
  assert.ok("stepUp" in (await asked("computer_control_screen", { app: "mail", action: "left_click", coordinate: [20, 270] })));
  assert.match(((await asked("computer_control_elements", { app: "mail", action: "click", ref: "e6" })) as { refuse: string }).refuse, /did not say how much/);
  assert.ok("stepUp" in (await asked("computer_control_elements", { app: "mail", action: "click", ref: "e6", amount: 12 })));
  // A reference that was never read is not known to be anything.
  assert.ok("stepUp" in (await asked("computer_control_elements", { app: "mail", action: "click", ref: "e99" })));
  // After reading a window, what moves about still goes ahead.
  assert.deepEqual(await asked("computer_control_elements", { app: "mail", action: "click", ref: "e5" }, { tainted: true }), { allow: true });
});

test("presses without the pointer where the helper can, and says what the press changed", async (t) => {
  const { environment, run, helper } = await connected(t, ["--activate"]);
  await environment.setMode("mail", "act");
  await run("computer_control_elements", { app: "mail", action: "read" });
  assert.equal(await run("computer_control_elements", { app: "mail", action: "click", ref: "e3" }), 'Clicked button "Send" [e3].\ngone: button "Send" [e3]');
  assert.deepEqual(await helper.call("log"), [["activate", "com.example.mail", "e3"]]);
  await assert.rejects(run("computer_control_elements", { app: "mail", action: "click", ref: "e3" }), /e3 is no longer in the window/);
});

test("a picture of the window comes back as one, and a window that changed size is read afresh", async (t) => {
  const { run, helper } = await connected(t);
  const shot = (await run("computer_control_screen", { app: "mail", action: "screenshot" })) as Record<symbol, unknown>;
  assert.equal(Object.getOwnPropertySymbols(shot).length, 1);
  assert.match(JSON.stringify(shot), /800 by 600/);
  await helper.call("resize", { width: 1000, height: 700 });
  assert.match(JSON.stringify(await run("computer_control_screen", { app: "mail", action: "screenshot" })), /1000 by 700/);
});

test("opens an app in draft mode", async (t) => {
  const { environment, run, helper } = await connected(t);
  await assert.rejects(run("computer_control_open", { app: "notes" }), /read mode/);
  await environment.setMode("notes", "draft");
  assert.equal(await run("computer_control_open", { app: "notes" }), "Notes is open.");
  assert.deepEqual(await helper.call("log"), [["open", "com.example.notes"]]);
});

test("doctor says what the helper lacks, and that there is no helper", async (t) => {
  const ready = await connected(t);
  assert.deepEqual(
    (await ready.environment.doctor()).filter((each) => ["helper", "permissions", "apps"].includes(each.name)).map((each) => [each.name, each.ok]),
    [
      ["helper", true],
      ["permissions", true],
      ["apps", true],
    ],
  );
  const unready = await connected(t, ["--unready"]);
  const lacking = (await unready.environment.doctor()).find((each) => each.name === "permissions")!;
  assert.deepEqual([lacking.ok, lacking.detail, lacking.fix], [false, "missing: Accessibility", "Allow it in the system's settings."]);

  const root = await mkdtemp(join(tmpdir(), "computer-control-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const absent = computerControl({ apps: ["Mail"], helper: ["praecise-no-such-helper"], vault: vault() });
  absent.use({ root, env: {} });
  const missing = (await absent.doctor()).find((each) => each.name === "helper")!;
  assert.equal(missing.ok, false);
  assert.match(missing.detail!, /could not start the helper praecise-no-such-helper/);
});

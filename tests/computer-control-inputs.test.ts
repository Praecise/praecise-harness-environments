// What a person may allow beside apps: folders, a coding agent in a folder, the camera
// and the microphone. The coding agent is a stand-in; the camera and the microphone are
// FFmpeg's own test sources, and are tried only where FFmpeg is.
//
//   node --test tests/computer-control-inputs.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { claude, codex, computerControl, type ComputerControlOptions, type Helper } from "../computer-control/index.ts";

const AGENT = fileURLToPath(new URL("./fixtures/coding-agent.mjs", import.meta.url));
const FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

const vault = () => {
  const kept = new Map<string, string>();
  return { kind: "memory", get: async (id: string) => kept.get(id), put: async (id: string, secret: string) => void kept.set(id, secret), delete: async (id: string) => void kept.delete(id) };
};
const none: Helper = { call: () => Promise.reject(new Error("no helper here")), close: () => undefined };

const connected = async (t: { after(run: () => unknown): void }, options: (work: string) => Partial<ComputerControlOptions>) => {
  const root = await mkdtemp(join(tmpdir(), "computer-control-inputs-"));
  const work = join(root, "work");
  await mkdir(work);
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = computerControl({ apps: [], helper: none, vault: vault(), ...options(work) });
  environment.use({ root, env: {} });
  await environment.connect();
  await environment.sync();
  const run = (name: string, args: Record<string, unknown>) => Promise.resolve().then(() => environment.app!.functions![name]!.run(args, {}));
  const asked = (name: string, args: Record<string, unknown>) =>
    environment.authority!.check({ agent: "app", tool: name, origin: "local", args, action: environment.app!.functions![name]!.action!(args) });
  return { environment, run, asked, root, work };
};

test("a folder is read in read mode, written only when allowed, and nothing outside it is reached", async (t) => {
  const { environment, run, asked, root, work } = await connected(t, (folder) => ({ folders: [folder] }));
  assert.deepEqual((await environment.accounts()).map((each) => [each.alias, each.kind, each.mode]), [["work", "folder", "read"]]);
  await writeFile(join(work, "notes.txt"), "first line\n");
  await writeFile(join(root, "secret.txt"), "not theirs");
  await symlink(join(root, "secret.txt"), join(work, "link.txt"));

  assert.match(String(await run("computer_control_files", { folder: "work", action: "list" })), /notes\.txt {2}11 bytes/);
  assert.equal(await run("computer_control_files", { folder: "work", action: "read", path: "notes.txt" }), "first line\n");
  await assert.rejects(run("computer_control_files", { folder: "work", action: "read", path: "../secret.txt" }), /outside the folder/);
  await assert.rejects(run("computer_control_files", { folder: "work", action: "read", path: "link.txt" }), /outside the folder/);
  await assert.rejects(run("computer_control_files", { folder: "work", action: "write", path: "made/new.txt", content: "x" }), /read mode/);

  // Writing and deleting are not reading.
  const writing = { folder: "work", action: "write", path: "made/new.txt", content: "made by an agent" };
  assert.deepEqual(await asked("computer_control_files", { folder: "work", action: "read", path: "notes.txt" }), { allow: true });
  assert.ok(!("allow" in (await asked("computer_control_files", writing))));
  await environment.setMode("work", "act");
  // In act mode a write still waits for a person, until the person says writes there need no asking.
  assert.ok("stepUp" in (await asked("computer_control_files", writing)));
  await environment.setWaive("work", ["publish"]);
  assert.deepEqual(await asked("computer_control_files", writing), { allow: true });
  assert.ok("stepUp" in (await asked("computer_control_files", { folder: "work", action: "delete", path: "notes.txt" })), "deleting waits for a person whatever was waived");
  await run("computer_control_files", writing);
  await assert.rejects(run("computer_control_files", { folder: "work", action: "write", path: "link.txt", content: "x" }), /outside the folder/);
  assert.equal(await readFile(join(work, "made", "new.txt"), "utf8"), "made by an agent");
  assert.equal(await readFile(join(root, "secret.txt"), "utf8"), "not theirs");
});

test("a coding agent is started in its folder, asked about, carried on and stopped", async (t) => {
  const stand = { start: [process.execPath, AGENT, "-p"], resume: claude.resume, read: claude.read };
  const { environment, run, asked, work } = await connected(t, (folder) => ({ coding: { folders: [folder], agents: { claude: stand } } }));
  assert.deepEqual((await environment.accounts()).map((each) => [each.alias, each.kind, each.mode]), [["work-code", "workspace", "read"]]);
  const starting = { workspace: "work-code", action: "start", agent: "claude", prompt: "add a test; echo $(id)" };
  assert.ok(!("allow" in (await asked("computer_control_code", starting))), "starting an agent is not reading");
  assert.deepEqual(await asked("computer_control_code", { workspace: "work-code", action: "list" }), { allow: true });

  await assert.rejects(run("computer_control_code", starting), /read mode/);
  await environment.setMode("work-code", "act");
  assert.ok("stepUp" in (await asked("computer_control_code", starting)), "each request to a coding agent waits for a person");
  await environment.setWaive("work-code", ["publish"]);
  assert.deepEqual(await asked("computer_control_code", starting), { allow: true });
  assert.match(String(await run("computer_control_code", starting)), /Started s1: claude in work/);
  const finished = async (session: string): Promise<string> => {
    for (let tries = 0; tries < 100; tries += 1) {
      const said = String(await run("computer_control_code", { workspace: "work-code", action: "status", session }));
      if (!said.includes("at work")) return said;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("it never finished");
  };
  assert.match(await finished("s1"), /turn 1, finished\.\nDid: add a test; echo \$\(id\)$/);
  // What was asked reached the agent as it was written, and was run by nothing.
  assert.equal(await readFile(join(work, "asked.txt"), "utf8"), "add a test; echo $(id)\n");

  assert.match(String(await run("computer_control_code", { workspace: "work-code", action: "say", session: "s1", prompt: "now document it" })), /at work/);
  assert.match(await finished("s1"), /turn 2, finished\.\nDid: now document it \(carried on\)$/);

  await run("computer_control_code", { workspace: "work-code", action: "start", agent: "claude", prompt: "wait" });
  await assert.rejects(run("computer_control_code", { workspace: "work-code", action: "say", session: "s2", prompt: "more" }), /still at work/);
  assert.match(String(await run("computer_control_code", { workspace: "work-code", action: "stop", session: "s2" })), /told to stop/);
  assert.match(await finished("s2"), /stopped/);
  assert.match(String(await run("computer_control_code", { workspace: "work-code", action: "list" })), /^s1: .*\ns2: /);
});

test("each coding agent's own output is read for its session and what it said", () => {
  assert.deepEqual(claude.read('{"type":"result","session_id":"abc","result":"done"}\n'), { session: "abc", said: "done" });
  assert.deepEqual(claude.read("not json"), {});
  assert.deepEqual(
    codex.read(['{"type":"thread.started","thread_id":"t1"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"type":"agent_message","text":"all done"}}', '{"type":"turn.completed"}'].join("\n")),
    { session: "t1", said: "all done" },
  );
});

test("the camera gives one picture and the microphone a few seconds of sound", { skip: !FFMPEG }, async (t) => {
  const { environment, run } = await connected(t, () => ({ camera: ["-f", "lavfi", "-i", "testsrc=size=320x240:rate=5"], microphone: ["-f", "lavfi", "-i", "sine=frequency=440"] }));
  assert.deepEqual((await environment.accounts()).map((each) => [each.alias, each.kind, each.mode]), [["camera", "camera", "read"], ["microphone", "microphone", "read"]]);
  // What was attached, wherever the harness keeps it on the answer.
  const media = (value: unknown): { mime: string; data: string } | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const one = value as { mime?: unknown; data?: unknown };
    if (typeof one.mime === "string" && typeof one.data === "string") return one as { mime: string; data: string };
    for (const key of Reflect.ownKeys(value)) {
      const found = media((value as Record<string | symbol, unknown>)[key]);
      if (found) return found;
    }
    return undefined;
  };
  const picture = media(await run("computer_control_camera", { camera: "camera" }))!;
  assert.equal(picture.mime, "image/jpeg");
  assert.deepEqual([...Buffer.from(picture.data, "base64").subarray(0, 2)], [0xff, 0xd8]);
  const sound = media(await run("computer_control_microphone", { microphone: "microphone", seconds: 1 }))!;
  assert.equal(sound.mime, "audio/wav");
  assert.equal(Buffer.from(sound.data, "base64").subarray(0, 4).toString(), "RIFF");
  assert.ok(Buffer.from(sound.data, "base64").length > 16_000, "about a second of sound");
});

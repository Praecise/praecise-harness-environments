// The Apple development environment: its skills carry the team's values, and it says
// what a machine is missing.
//
//   node --test tests/apple-development.test.ts

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { apple, appleDevelopment } from "../apple-development/index.ts";

const team = {
  team: "ABCDE12345",
  teamName: "Example Ltd",
  bundlePrefix: "com.example",
  developmentIdentity: "Apple Development: Jane Doe (ABCDE12345)",
  notaryProfile: "example-notary",
};

test("fills the team's values into every skill and leaves no placeholder", () => {
  const environment = appleDevelopment(team);
  const skills = Object.values(environment.app!.skills!);
  assert.equal(skills.length, 5);
  const text = skills.map((skill) => `${skill.description}\n${skill.body}`).join("\n");
  assert.ok(text.includes("ABCDE12345"));
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(text));
  assert.equal(environment.name, "apple-development");
  assert.equal(apple, appleDevelopment);
});

test("lists what the machine is missing, each with its fix", async () => {
  const root = await mkdtemp(join(tmpdir(), "apple-development-"));
  const environment = appleDevelopment(team);
  environment.use({ root, env: {} });
  const lines = await environment.doctor();
  const names = lines.map((line) => line.name);
  assert.ok(names.includes("Xcode"));
  assert.ok(names.includes("identity  Developer ID Application: Example Ltd (ABCDE12345)"));
  assert.ok(names.includes("notarization credential (example-notary)"));
  // Nothing has been found on this machine yet, and the list says how to find it.
  assert.ok(lines.some((line) => !line.ok && line.fix === "praecise apple-development connect"));
  await rm(root, { recursive: true, force: true });
});

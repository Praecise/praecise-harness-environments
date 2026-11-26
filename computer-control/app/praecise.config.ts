// Praecise Control as an app of its own, for a client that speaks MCP: Claude Code,
// Codex, Cursor, VS Code, Gemini CLI. The client starts `praecise mcp` in this folder and
// is given the apps on this machine as tools, held to each app's mode.
//
//   PRAECISE_CONTROL_APPS     the apps an agent may be shown, separated by commas
//   PRAECISE_CONTROL_HELPER   the command that reaches Praecise Control, as a JSON list
//   PRAECISE_CONTROL_FOLDERS  folders an agent may be shown, separated by commas
//   PRAECISE_CONTROL_CODE     folders a coding agent (Claude Code, Codex) may be started in
//   PRAECISE_CONTROL_CAMERA   1 to allow the camera; PRAECISE_CONTROL_MICROPHONE likewise
//                             (praecise-computer-helper on the path unless said)

import { defineConfig } from "@praecise/harness";
import { computerControl } from "@praecise/harness-environments/computer-control";

const list = (name: string): string[] => (process.env[name] ?? "").split(",").map((each) => each.trim()).filter(Boolean);
const apps = list("PRAECISE_CONTROL_APPS");
const helper = process.env.PRAECISE_CONTROL_HELPER ? (JSON.parse(process.env.PRAECISE_CONTROL_HELPER) as string[]) : undefined;
const folders = list("PRAECISE_CONTROL_FOLDERS");
const coding = list("PRAECISE_CONTROL_CODE");

export default defineConfig({
  name: "praecise-control",
  plugins: [
    computerControl({
      apps,
      ...(helper ? { helper } : {}),
      ...(folders.length ? { folders } : {}),
      ...(coding.length ? { coding: { folders: coding } } : {}),
      ...(process.env.PRAECISE_CONTROL_CAMERA === "1" ? { camera: true } : {}),
      ...(process.env.PRAECISE_CONTROL_MICROPHONE === "1" ? { microphone: true } : {}),
    }),
  ],
});

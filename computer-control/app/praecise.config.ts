// Praecise Control as an app of its own, for a client that speaks MCP: Claude Code,
// Codex, Cursor, VS Code, Gemini CLI. The client starts `praecise mcp` in this folder and
// is given the apps on this machine as tools, held to each app's mode.
//
//   PRAECISE_CONTROL_APPS     the apps an agent may be shown, separated by commas
//   PRAECISE_CONTROL_HELPER   the command that reaches Praecise Control, as a JSON list
//                             (praecise-computer-helper on the path unless said)

import { defineConfig } from "@praecise/harness";
import { computerControl } from "@praecise/harness-environments/computer-control";

const apps = (process.env.PRAECISE_CONTROL_APPS ?? "").split(",").map((each) => each.trim()).filter(Boolean);
const helper = process.env.PRAECISE_CONTROL_HELPER ? (JSON.parse(process.env.PRAECISE_CONTROL_HELPER) as string[]) : undefined;

export default defineConfig({
  name: "praecise-control",
  plugins: [computerControl({ apps, ...(helper ? { helper } : {}) })],
});

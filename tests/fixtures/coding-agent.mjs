#!/usr/bin/env node
// A stand-in for a coding agent run without its interface: it reads its request from
// its input, writes a file in the folder it was started in, and prints one JSON object
// naming its session, as Claude Code does.
let asked = "";
process.stdin.on("data", (chunk) => (asked += chunk));
process.stdin.on("end", async () => {
  const { appendFile } = await import("node:fs/promises");
  const at = process.argv.indexOf("--resume");
  const session = at > 0 ? process.argv[at + 1] : "conversation-one";
  await appendFile("asked.txt", `${asked}\n`);
  if (asked.includes("wait")) await new Promise((resolve) => setTimeout(resolve, 60_000));
  process.stdout.write(`${JSON.stringify({ type: "result", session_id: session, result: `Did: ${asked}${at > 0 ? " (carried on)" : ""}` })}\n`);
});

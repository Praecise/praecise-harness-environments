// A stand-in for a computer helper: three apps, one window each, spoken to in lines of JSON.
import { createInterface } from "node:readline";

const PNG = "iVBORw0KGgo=";
const apps = [
  { id: "com.example.mail", name: "Mail" },
  { id: "com.example.notes", name: "Notes" },
  { id: "com.example.passwords", name: "Passwords" },
];
const did = [];
let size = { width: 800, height: 600 };
let sent = false;
const elements = () => [
  { ref: "e1", role: "textbox", name: "To", value: "", box: { x: 10, y: 10, width: 200, height: 20 } },
  { ref: "e2", role: "textbox", name: "Message", box: { x: 10, y: 40, width: 400, height: 200 } },
  ...(sent ? [] : [{ ref: "e3", role: "button", name: "Send", box: { x: 10, y: 260, width: 60, height: 24 } }]),
  { ref: "e4", role: "button", name: "Delete draft", box: { x: 80, y: 260, width: 90, height: 24 } },
  { ref: "e5", role: "button", name: "Next", box: { x: 180, y: 260, width: 60, height: 24 } },
  { ref: "e6", role: "button", name: "Pay now", box: { x: 250, y: 260, width: 60, height: 24 } },
  { ref: "e7", role: "checkbox", name: "Sync over mobile data", box: { x: 320, y: 260, width: 20, height: 20 } },
];

const answer = {
  hello: () => ({
    system: "linux",
    user: "tester",
    host: "box",
    can: process.argv.includes("--activate") ? ["activate", "fill"] : ["fill"],
    needs: [{ name: "Accessibility", ok: !process.argv.includes("--unready"), fix: "Allow it in the system's settings." }],
  }),
  apps: () => apps,
  window: () => ({ ...size, title: "New message" }),
  resize: ({ width, height }) => void (size = { width, height }),
  open: ({ app }) => void did.push(["open", app]),
  read: ({ filter }) => (filter === "interactive" ? elements() : [{ ref: "e0", role: "window", name: "New message", children: elements() }]),
  locate: ({ ref }) => {
    const found = elements().find((each) => each.ref === ref);
    if (!found) throw new Error(`${ref} is no longer in the window; read it again`);
    return found;
  },
  screenshot: () => ({ mime: "image/png", data: PNG, name: "screenshot.png" }),
  cursor: () => ({ x: 1, y: 2 }),
  activate: ({ app, ref }) => {
    did.push(["activate", app, ref]);
    if (ref === "e3") sent = true;
  },
  log: () => did,
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  try {
    const known = answer[method];
    const result = known ? known(params) : void did.push([method, params.app, ...Object.entries(params).filter(([key]) => key !== "app").map(([, value]) => value)]);
    process.stdout.write(`${JSON.stringify({ id, result: result ?? null })}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ id, error: err.message })}\n`);
  }
});

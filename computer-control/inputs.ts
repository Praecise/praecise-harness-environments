// What a person may allow on a machine beside its apps' windows: folders, a camera, a
// microphone, and a coding agent at work in a folder. Each is an account like an app is,
// named by the person in the config, starting in read mode, and held to what is asked.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { attach, type ActionClass, type environment } from "@praecise/harness";

type Actions = NonNullable<Parameters<typeof environment>[0]["actions"]>;

/** A coding agent that can be started in a folder: how it is started, carried on, and read. */
export interface CodingAgent {
  /** The command and the arguments it always takes. The request is written to its input, never put among these. */
  start: string[];
  /** The arguments that carry on an earlier session, given that session's own id. */
  resume(session: string): string[];
  /** The session's own id and what the agent said last, read from everything it printed. */
  read(printed: string): { session?: string; said?: string };
}

export interface InputOptions {
  /** Folders an agent may be shown. Nothing outside them is listed, read or written. */
  folders?: string[];
  /** Folders a coding agent may be started in, and the agents that may be started there. `claude` and `codex` unless said. */
  coding?: { folders: string[]; agents?: Record<string, CodingAgent>; minutes?: number };
  /** The camera: true for the system's first one, or the arguments that name one to FFmpeg. */
  camera?: boolean | string[];
  /** The microphone: true for the system's default, or the arguments that name one to FFmpeg. */
  microphone?: boolean | string[];
  /** FFmpeg, which takes the picture and the sound. `ffmpeg` on the path unless said. */
  ffmpeg?: string;
}

const LARGEST_READ = 200_000;
const LARGEST_WRITE = 1_000_000;
const LARGEST_PICTURE = 4_000_000;
const PICTURES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/**
 * The place a path names inside a folder, with every link in it followed. A path that
 * leaves the folder, by `..` or through a link, is refused.
 */
export async function within(folder: string, path: unknown): Promise<string> {
  const root = await realpath(folder);
  const asked = resolve(root, typeof path === "string" && path ? path : ".");
  // What exists of it is followed to where it really is; what does not exist yet is added back.
  let exists = asked;
  while (!existsSync(exists) && dirname(exists) !== exists) exists = dirname(exists);
  const real = join(await realpath(exists), relative(exists, asked));
  if (real !== root && !real.startsWith(root + sep)) throw new Error("that is outside the folder");
  return real;
}

function filesActions(): Actions {
  return {
    computer_control_files: {
      description:
        "Work the files in a folder the person allowed. `list` says what is in a place, `read` returns a file's text (or a picture), " +
        "`write` puts text in a file, `delete` removes one file or one empty folder. Paths are inside the folder; nothing outside it can be reached. " +
        "Writing over a file that is there, and deleting, wait for a person unless the folder's mode allows them.",
      schema: {
        type: "object",
        properties: {
          folder: { type: "string", description: "The folder, by the name it is listed under." },
          action: { type: "string", enum: ["list", "read", "write", "delete"], description: "What to do." },
          path: { type: "string", description: "The place inside the folder. The folder itself when left out." },
          content: { type: "string", description: "For write: the text to put in the file." },
          offset: { type: "integer", description: "For read: where to start, in bytes. 0 unless said." },
        },
        required: ["folder", "action"],
      },
      accounts: { folder: "folder" },
      trust: "untrusted",
      class(args): ActionClass {
        if (args.action === "list" || args.action === "read") return "read";
        if (args.action === "delete") return "destroy";
        // A new file is a draft; one written over is gone.
        return "publish";
      },
      run: async (args, { accounts }) => {
        const folder = accounts.folder!.id;
        const place = await within(folder, args.path);
        const shown = relative(await realpath(folder), place) || ".";
        if (args.action === "list") {
          const entries = (await readdir(place, { withFileTypes: true })).slice(0, 500);
          const lines = await Promise.all(
            entries.map(async (each) => (each.isDirectory() ? `${each.name}/` : `${each.name}  ${(await stat(join(place, each.name)).catch(() => undefined))?.size ?? "?"} bytes`)),
          );
          return lines.length ? `${shown}:\n${lines.join("\n")}` : `${shown} is empty.`;
        }
        if (args.action === "read") {
          const size = (await stat(place)).size;
          const kind = PICTURES[extname(place).toLowerCase()];
          if (kind) {
            if (size > LARGEST_PICTURE) throw new Error("that picture is too large to pass on");
            return attach(`${shown}, ${size} bytes.`, { mime: kind, data: (await readFile(place)).toString("base64"), name: basename(place) });
          }
          const from = typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : 0;
          const text = (await readFile(place)).subarray(from, from + LARGEST_READ);
          if (text.includes(0)) throw new Error("that file is not text");
          const more = from + text.length < size ? `\n[${size - from - text.length} more bytes; read again with offset ${from + text.length}]` : "";
          return `${text.toString("utf8")}${more}`;
        }
        if (args.action === "write") {
          if (typeof args.content !== "string") throw new Error("`content` is the text to write");
          if (Buffer.byteLength(args.content) > LARGEST_WRITE) throw new Error("that is too much to write at once");
          await mkdir(dirname(place), { recursive: true });
          await writeFile(place, args.content);
          return `Wrote ${Buffer.byteLength(args.content)} bytes to ${shown}.`;
        }
        if (args.action === "delete") {
          if (shown === ".") throw new Error("the folder itself is not deleted from here");
          // One file, or one empty folder: the system refuses a folder with anything in it.
          if ((await stat(place)).isDirectory()) await rmdir(place);
          else await rm(place);
          return `Deleted ${shown}.`;
        }
        throw new Error("`action` is list, read, write or delete");
      },
    },
  };
}

// Coding agents.

/** Claude Code, run without its interface. It prints one JSON object when it is done. */
export const claude: CodingAgent = {
  start: ["claude", "-p", "--output-format", "json"],
  resume: (session) => ["--resume", session],
  read(printed) {
    try {
      const done = JSON.parse(printed.trim().split("\n").at(-1) ?? "") as { session_id?: string; result?: string };
      return { ...(typeof done.session_id === "string" ? { session: done.session_id } : {}), ...(typeof done.result === "string" ? { said: done.result } : {}) };
    } catch {
      return {};
    }
  },
};

/** Codex, run without its interface. It prints one JSON object for each thing that happens. */
export const codex: CodingAgent = {
  start: ["codex", "exec", "--json", "--skip-git-repo-check", "-"],
  resume: (session) => ["resume", session],
  read(printed) {
    const out: { session?: string; said?: string } = {};
    for (const line of printed.split("\n")) {
      let event: { type?: string; thread_id?: string; item?: { type?: string; text?: string } };
      try {
        event = JSON.parse(line) as typeof event;
      } catch {
        continue;
      }
      if (event.type === "thread.started" && typeof event.thread_id === "string") out.session = event.thread_id;
      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") out.said = event.item.text;
    }
    return out;
  },
};

interface Session {
  name: string;
  agent: string;
  folder: string;
  /** The agent's own id for it, once it has said one. */
  own?: string;
  running: boolean;
  printed: string;
  complained: string;
  said?: string;
  code?: number | null;
  turns: number;
  since: number;
  stop?: () => void;
}

function codeActions(options: NonNullable<InputOptions["coding"]>): Actions {
  const agents: Record<string, CodingAgent> = options.agents ?? { claude, codex };
  const longest = Math.min(Math.max(options.minutes ?? 30, 1), 240) * 60_000;
  const sessions = new Map<string, Session>();
  let counted = 0;

  const turn = (session: Session, prompt: string): void => {
    const agent = agents[session.agent]!;
    // Codex takes `resume <id>` after `exec`; Claude Code takes `--resume <id>` anywhere.
    const args = session.own ? (session.agent === "codex" ? [agent.start[1]!, ...agent.resume(session.own), ...agent.start.slice(2)] : [...agent.start.slice(1), ...agent.resume(session.own)]) : agent.start.slice(1);
    // The request goes in on its input. Nothing an agent wrote is ever part of a command line.
    const child = spawn(agent.start[0]!, args, { cwd: session.folder, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
    session.running = true;
    session.printed = "";
    session.complained = "";
    session.turns += 1;
    delete session.said;
    delete session.code;
    const limit = setTimeout(() => child.kill(), longest);
    session.stop = () => child.kill();
    child.stdout.on("data", (chunk) => (session.printed = (session.printed + String(chunk)).slice(-2_000_000)));
    child.stderr.on("data", (chunk) => (session.complained = (session.complained + String(chunk)).slice(-20_000)));
    const ended = (code: number | null, why?: string): void => {
      if (!session.running) return;
      clearTimeout(limit);
      session.running = false;
      session.code = code;
      const read = agent.read(session.printed);
      if (read.session) session.own = read.session;
      const said = read.said ?? why;
      if (said) session.said = said;
      delete session.stop;
    };
    child.on("error", (err) => ended(null, `${agent.start[0]} could not be started: ${err.message}`));
    child.on("close", (code) => ended(code));
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
  };

  const about = (session: Session): string => {
    const head = `${session.name}: ${session.agent} in ${basename(session.folder)}, turn ${session.turns}, ${session.running ? "at work" : session.code === 0 ? "finished" : `stopped${session.code === null || session.code === undefined ? "" : ` with ${session.code}`}`}.`;
    if (session.running) return `${head}\nWhat it has printed so far ends:\n${session.printed.slice(-1500) || "(nothing yet)"}`;
    return `${head}\n${session.said ?? (session.complained.slice(-1500) || session.printed.slice(-1500) || "(it said nothing)")}`;
  };

  return {
    computer_control_code: {
      description:
        `Have a coding agent (${Object.keys(agents).join(", ")}) work in a folder the person allowed for it. \`start\` begins a session with a request and names it; ` +
        "`status` says whether it is still at work and what it said; `say` gives a finished session its next request, in the same conversation; " +
        "`stop` ends one that is at work; `list` names the sessions. A session works on its own and is asked about afterwards: start it, then ask its status. " +
        "The agent runs with the permissions the person set for it on that machine.",
      schema: {
        type: "object",
        properties: {
          workspace: { type: "string", description: "The folder, by the name it is listed under." },
          action: { type: "string", enum: ["start", "status", "say", "stop", "list"], description: "What to do." },
          agent: { type: "string", enum: Object.keys(agents), description: "For start: which coding agent." },
          prompt: { type: "string", description: "For start and say: what to ask of it." },
          session: { type: "string", description: "For status, say and stop: the session, as start named it." },
        },
        required: ["workspace", "action"],
      },
      accounts: { workspace: "workspace" },
      trust: "untrusted",
      class(args): ActionClass {
        if (args.action === "status" || args.action === "list") return "read";
        if (args.action === "stop") return "draft";
        // It changes files and runs commands there.
        return "publish";
      },
      run: async (args, { accounts }) => {
        const folder = await realpath(accounts.workspace!.id);
        const mine = [...sessions.values()].filter((each) => each.folder === folder);
        if (args.action === "list") return mine.length ? mine.map((each) => about(each).split("\n")[0]).join("\n") : "No session has been started in this folder.";
        if (args.action === "start") {
          const which = typeof args.agent === "string" ? args.agent : Object.keys(agents)[0]!;
          if (!agents[which]) throw new Error(`\`agent\` is one of: ${Object.keys(agents).join(", ")}`);
          if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new Error("`prompt` is what to ask of it");
          if (mine.filter((each) => each.running).length >= 4) throw new Error("four sessions are at work in this folder already");
          const session: Session = { name: `s${++counted}`, agent: which, folder, running: false, printed: "", complained: "", turns: 0, since: Date.now() };
          sessions.set(session.name, session);
          turn(session, args.prompt);
          return `Started ${session.name}: ${which} in ${basename(folder)}. Ask its status to see how it is doing.`;
        }
        const session = mine.find((each) => each.name === args.session);
        if (!session) throw new Error("that is not a session in this folder");
        if (args.action === "status") return about(session);
        if (args.action === "stop") {
          if (!session.running) return `${session.name} is not at work.`;
          session.stop?.();
          return `${session.name} was told to stop.`;
        }
        if (args.action === "say") {
          if (session.running) throw new Error(`${session.name} is still at work; ask its status, or stop it first`);
          if (!session.own) throw new Error(`${session.name} never said which conversation it was, so it cannot be carried on; start another`);
          if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new Error("`prompt` is what to ask of it");
          turn(session, args.prompt);
          return `${session.name} is at work on that.`;
        }
        throw new Error("`action` is start, status, say, stop or list");
      },
    },
  };
}

// The camera and the microphone, through FFmpeg.

function ffmpeg(program: string, args: string[], seconds: number): Promise<{ code: number | null; said: string }> {
  return new Promise((done, failed) => {
    const child = spawn(program, ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let said = "";
    const limit = setTimeout(() => child.kill(), (seconds + 20) * 1000);
    child.stderr.on("data", (chunk) => (said = (said + String(chunk)).slice(-8000)));
    child.on("error", (err) => {
      clearTimeout(limit);
      failed(new Error(`FFmpeg could not be started (${err.message}); it takes the picture and the sound`));
    });
    child.on("close", (code) => {
      clearTimeout(limit);
      done({ code, said });
    });
  });
}

/** The first camera or microphone Windows names, which FFmpeg there is told by name. */
async function named(program: string, kind: "video" | "audio"): Promise<string> {
  const { said } = await ffmpeg(program, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], 10);
  const [, name] = new RegExp(`"([^"]+)"\\s+\\(${kind}\\)`).exec(said) ?? [];
  if (!name) throw new Error(`this machine names no ${kind === "video" ? "camera" : "microphone"}`);
  return name;
}

async function source(program: string, kind: "video" | "audio", given: boolean | string[]): Promise<string[]> {
  if (Array.isArray(given)) return given;
  if (process.platform === "darwin") return kind === "video" ? ["-f", "avfoundation", "-framerate", "30", "-i", "0:none"] : ["-f", "avfoundation", "-i", ":0"];
  if (process.platform === "win32") return ["-f", "dshow", "-i", `${kind}=${await named(program, kind)}`];
  return kind === "video" ? ["-f", "v4l2", "-i", "/dev/video0"] : ["-f", "pulse", "-i", "default"];
}

function captureActions(options: InputOptions): Actions {
  const program = options.ffmpeg ?? "ffmpeg";
  const taken = async (args: string[], file: string, seconds: number): Promise<Buffer> => {
    const folder = await mkdtemp(join(tmpdir(), "praecise-control-"));
    try {
      const out = join(folder, file);
      const { code, said } = await ffmpeg(program, ["-loglevel", "error", ...args, "-y", out], seconds);
      if (code !== 0 || !existsSync(out)) throw new Error(`it could not be taken: ${said.trim().split("\n").at(-1) ?? "FFmpeg said nothing"}`);
      return await readFile(out);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
  const actions: Actions = {};
  if (options.camera) {
    actions.computer_control_camera = {
      description: "Take one picture with the machine's camera, which the person allowed. Nothing is kept on the machine.",
      input: { camera: "the camera, by the name it is listed under" },
      accounts: { camera: "camera" },
      trust: "untrusted",
      class: "read",
      run: async () => {
        const picture = await taken([...(await source(program, "video", options.camera!)), "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-f", "image2", "-c:v", "mjpeg"], "picture.jpg", 10);
        return attach("One picture from the camera.", { mime: "image/jpeg", data: picture.toString("base64"), name: "camera.jpg" });
      },
    };
  }
  if (options.microphone) {
    actions.computer_control_microphone = {
      description: "Listen through the machine's microphone, which the person allowed, for a few seconds, and return the sound. Nothing is kept on the machine.",
      schema: {
        type: "object",
        properties: {
          microphone: { type: "string", description: "The microphone, by the name it is listed under." },
          seconds: { type: "integer", description: "How long to listen. 5 unless said, at most 60." },
        },
        required: ["microphone"],
      },
      accounts: { microphone: "microphone" },
      trust: "untrusted",
      class: "read",
      run: async (args) => {
        const seconds = Math.min(Math.max(typeof args.seconds === "number" ? Math.floor(args.seconds) : 5, 1), 60);
        const sound = await taken([...(await source(program, "audio", options.microphone!)), "-t", String(seconds), "-ac", "1", "-ar", "16000", "-f", "wav"], "sound.wav", seconds);
        return attach(`${seconds}s from the microphone.`, { mime: "audio/wav", data: sound.toString("base64"), name: "microphone.wav" });
      },
    };
  }
  return actions;
}

/** The accounts these inputs are, for the list a person sees and sets modes on. */
export async function inputAccounts(options: InputOptions): Promise<{ kind: string; id: string; name: string }[]> {
  const found: { kind: string; id: string; name: string }[] = [];
  const taken = new Set<string>();
  const called = (path: string, suffix: string): string => {
    let name = `${basename(path) || path}${suffix}`;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${basename(path) || path}-${n}${suffix}`;
    taken.add(name.toLowerCase());
    return name;
  };
  for (const [kind, folders, suffix] of [["folder", options.folders ?? [], ""], ["workspace", options.coding?.folders ?? [], "-code"]] as const) {
    for (const each of folders) {
      const real = await realpath(each).catch(() => undefined);
      // One that is not there is not listed; `doctor` says so.
      if (real && (await stat(real)).isDirectory()) found.push({ kind, id: real, name: called(real, suffix) });
    }
  }
  if (options.camera) found.push({ kind: "camera", id: "camera", name: "camera" });
  if (options.microphone) found.push({ kind: "microphone", id: "microphone", name: "microphone" });
  return found;
}

/** Every action these inputs add, for what the person turned on. */
export function inputActions(options: InputOptions): Actions {
  return {
    ...(options.folders?.length ? filesActions() : {}),
    ...(options.coding?.folders.length ? codeActions(options.coding) : {}),
    ...captureActions(options),
  };
}

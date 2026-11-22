// Apple development environment for Claude by Praecise, as a praecise-harness plugin.
//
//   import { apple } from "@praecise/environments/apple";
//   export default defineConfig({ plugins: [apple({ team: "ABCDE12345", teamName: "Example Ltd", ... })] });
//
// The skills are the files in ./skills, the same ones install.sh gives to Claude Code
// and to Claude Agent in Xcode. Each holds {{PLACEHOLDERS}} for a team's values, filled
// in here from the options.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { agent, skillsIn, tool, type Plugin } from "@praecise/harness";

export interface AppleOptions {
  /** The ten-character Team ID from the developer account's membership details. */
  team: string;
  /** The team's name exactly as its certificates carry it, such as "Example Ltd". */
  teamName: string;
  /** Reverse-DNS prefix for bundle identifiers, without a trailing dot: "com.example". */
  bundlePrefix: string;
  /** The exact name of the development identity, as `security find-identity` prints it. */
  developmentIdentity: string;
  /** The name given to `xcrun notarytool store-credentials`. */
  notaryProfile: string;
}

type Command = NonNullable<Plugin["commands"]>[string];

const run = (cmd: string, args: string[]): string | undefined => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 });
  } catch {
    return undefined;
  }
};

/** The Apple environment for one developer team. */
export function apple(options: AppleOptions): Plugin {
  const here = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
  const values: Record<string, string> = {
    TEAM_ID: options.team,
    TEAM_NAME: options.teamName,
    BUNDLE_PREFIX: options.bundlePrefix,
    DEVELOPMENT_IDENTITY: options.developmentIdentity,
    NOTARY_PROFILE: options.notaryProfile,
    ENV_DIR: here,
  };
  const fill = (text: string): string => text.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key: string) => values[key] ?? whole);

  const skills = skillsIn(new URL("./skills", import.meta.url));
  for (const skill of Object.values(skills)) {
    skill.description = fill(skill.description);
    skill.body = fill(skill.body);
    for (const [path, text] of Object.entries(skill.files ?? {})) skill.files![path] = fill(text);
  }

  const identities = [
    options.developmentIdentity,
    `Apple Distribution: ${options.teamName} (${options.team})`,
    `Developer ID Application: ${options.teamName} (${options.team})`,
    `Developer ID Installer: ${options.teamName} (${options.team})`,
  ];

  /** Say what this machine is missing for Apple development. Returns 0 when nothing is. */
  const doctor: Command["run"] = (_argv, ctx) => {
    let missing = 0;
    const say = (ok: boolean, what: string, fix?: string): void => {
      if (!ok) missing += 1;
      ctx.out(`${ok ? "ok     " : "MISSING"}  ${what}${ok || !fix ? "" : `  ->  ${fix}`}`);
    };

    if (process.platform !== "darwin") {
      ctx.out("MISSING  macOS: Apple development needs a Mac");
      return 1;
    }
    const xcode = run("xcodebuild", ["-version"]);
    say(Boolean(xcode), `Xcode${xcode ? ` (${xcode.split("\n")[0]})` : ""}`, "install Xcode 26.3 or later");
    say(Boolean(run("xcrun", ["--find", "mcpbridge"])), "Xcode MCP bridge (xcrun mcpbridge)", "needs Xcode 26.3 or later");
    say(Boolean(run("pgrep", ["-x", "Xcode"])), "Xcode is running", "open the project in Xcode and allow external agents in Settings > Intelligence");

    const found = run("security", ["find-identity", "-v"]) ?? "";
    for (const name of identities) say(found.includes(name), `identity  ${name}`, "see docs/account-setup.md");

    const notary = run("xcrun", ["notarytool", "history", "--keychain-profile", options.notaryProfile]);
    say(Boolean(notary), `notarization credential (${options.notaryProfile})`, "see docs/account-setup.md");

    ctx.out(missing ? `${missing} missing` : "ready");
    return missing ? 1 : 0;
  };

  return {
    name: "apple",
    app: {
      skills,
      tools: { xcode: tool({ command: ["xcrun", "mcpbridge"] }) },
      agents: {
        apple: agent({
          description: "Builds, tests, signs and releases Apple platform apps.",
          role: [
            `You build, test, sign and release Apple platform apps for ${options.teamName} (team ${options.team}).`,
            "Never reread a file or output you already have. Never poll: run a build or test once and wait for it.",
            "Keep output small. One build per round: read all errors, fix all, then build again.",
            "Use the xcode tools for building, testing, diagnostics, previews and Apple documentation when Xcode is open.",
            "Confirm with the owner before any upload, notarization or change on the developer portal.",
            "Never write a key, .p12, .p8 or provisioning profile to disk.",
          ].join("\n"),
          tools: ["xcode"],
        }),
      },
    },
    commands: {
      doctor: { describe: "Say what this machine is missing for Apple development.", run: doctor },
    },
  };
}

export default apple;

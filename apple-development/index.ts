// Apple development environment for Claude by Praecise, as a praecise-harness environment.
//
//   import { appleDevelopment } from "@praecise/harness-environments/apple-development";
//   export default defineConfig({ plugins: [appleDevelopment({ team: "ABCDE12345", teamName: "Example Ltd", ... })] });
//
// The skills are the files in ./skills, the same ones install.sh gives to Claude Code
// and to Claude Agent in Xcode. Each holds {{PLACEHOLDERS}} for a team's values, filled
// in here from the options.
//
// There is nothing to sign in to: the team's signing identities live in the keychain of
// the Mac, and never leave it. `connect` finds them.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { agent, environment, skillsIn, tool, type Environment, type EnvironmentCheck, type FoundAccount } from "@praecise/harness";

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

const run = (cmd: string, args: string[]): string | undefined => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 });
  } catch {
    return undefined;
  }
};

/** The Apple development environment for one developer team. */
export function appleDevelopment(options: AppleOptions): Environment {
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
  const inKeychain = (): string => run("security", ["find-identity", "-v"]) ?? "";

  const check = (name: string, ok: () => boolean, fix: string): EnvironmentCheck => ({
    name,
    run: async () => (ok() ? { ok: true } : { ok: false, fix }),
  });

  return environment({
    name: "apple-development",
    description: "Building, testing, signing and releasing apps for Apple platforms with Xcode.",
    signIn: {
      kind: "local",
      // The team is here when its development identity is in the keychain.
      find: async () => (inKeychain().includes(options.developmentIdentity) ? { id: options.team, label: options.teamName } : undefined),
    },
    // The team, and each of its identities this Mac holds.
    discover: async () => {
      const held = inKeychain();
      const found: FoundAccount[] = [{ kind: "team", id: options.team, name: options.teamName }];
      for (const name of identities) {
        if (held.includes(name)) found.push({ kind: "signing_identity", id: name, name: name.split(":")[0]!, parent: `team:${options.team}` });
      }
      return found;
    },
    checks: [
      check("macOS", () => process.platform === "darwin", "Apple development needs a Mac"),
      check("Xcode", () => Boolean(run("xcodebuild", ["-version"])), "install Xcode 26.3 or later"),
      check("Xcode MCP bridge (xcrun mcpbridge)", () => Boolean(run("xcrun", ["--find", "mcpbridge"])), "needs Xcode 26.3 or later"),
      check("Xcode is running", () => Boolean(run("pgrep", ["-x", "Xcode"])), "open the project in Xcode and allow external agents in Settings > Intelligence"),
      ...identities.map((name) => check(`identity  ${name}`, () => inKeychain().includes(name), "see docs/account-setup.md")),
      check(
        `notarization credential (${options.notaryProfile})`,
        () => Boolean(run("xcrun", ["notarytool", "history", "--keychain-profile", options.notaryProfile])),
        "see docs/account-setup.md",
      ),
    ],
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
          tools: ["xcode", "apple_development_accounts"],
        }),
      },
    },
  });
}

/** The name this had before environments were named for a platform and a kind of work. */
export const apple = appleDevelopment;

export default appleDevelopment;

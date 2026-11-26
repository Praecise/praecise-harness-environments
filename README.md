# praecise-harness-environments

Environments for [praecise-harness](https://github.com/Praecise/praecise-harness).

An environment equips an agent for one platform and one kind of work on it: Apple
development, Meta Platforms marketing. It brings the skills for the work, the tools
that reach the platform, an agent that knows it, and a command that says what is
missing. Where the platform is one a person signs in to, it also brings the sign-in,
the accounts that sign-in reaches, and limits on what may be done to each.

Each environment is two things from one folder:

- A plugin for Claude Code, and its skills are plain
  [Agent Skills](https://agentskills.io/specification) folders that other tools can
  read.
- An environment for praecise-harness, which an app takes with a line in its config
  and then serves to Claude or any other client through one endpoint.

| Environment | For |
|---|---|
| [Apple development](apple-development/) | Building, testing, signing and releasing apps for iOS, iPadOS, macOS, tvOS, watchOS and visionOS, with Xcode |
| [Meta Platforms marketing](meta-marketing/) | Advertising on Facebook and Instagram, Page and Instagram publishing, comments and conversations, Threads, and WhatsApp Business messaging, through Meta's own MCP servers and its APIs |
| [Computer control](computer-control/) | Working the apps on a Mac, a Windows or a Linux machine: reading each window as the things in it, pressing and filling them by reference, with every press held to what is pressed. With a helper for each of the three systems. Not released: it needs a harness later than 1.2.1, and the helpers are built from source and not signed |

This package is at 0.3.0. Both environments are in it, and neither has a version of
its own.

## Use one

```
git clone https://github.com/Praecise/praecise-harness-environments
```

In a harness app, add the clone as a dependency (`npm install ../praecise-harness-environments`)
and list the environment:

```ts
import { defineConfig } from "@praecise/harness";
import { appleDevelopment } from "@praecise/harness-environments/apple-development";

export default defineConfig({ plugins: [appleDevelopment({ /* your team's values */ })] });
```

Both environments need `@praecise/harness` 1.2.1 or later, the first with
`environment()`, and Node 24, which runs the TypeScript here as it is. Install this
package from a clone, as above: Node does not run TypeScript that has been copied into
`node_modules`, and a linked folder is not a copy.

In Claude Code, the Meta Platforms marketing environment installs from this repository
as a marketplace (`/plugin marketplace add Praecise/praecise-harness-environments`, then
`/plugin install meta-marketing`). The Apple development environment installs with
`apple-development/install.sh`, which fills in your team's values and also sets it up for Claude
Agent in Xcode.

## Write one

An environment is a folder here, named for the platform and the work
(`meta-marketing`, not `meta`), with:

```
<name>/
  index.ts          export a function returning the environment
  skills/           one folder per skill, each a SKILL.md
  .claude-plugin/   the Claude Code plugin
  README.md         what it is for, what it needs, how to use it
```

For a toolchain on the machine, a plain plugin is enough:

```ts
import { agent, skillsIn, tool, type Plugin } from "@praecise/harness";

export function android(options: AndroidOptions): Plugin {
  return {
    name: "android-development",
    app: {
      skills: skillsIn(new URL("./skills", import.meta.url)),
      tools: { gradle: tool({ command: ["gradle-mcp"] }) },
      agents: {
        android: agent({ description: "Builds and releases the Android app.", role: "You build and release the Android app.", tools: ["gradle"] }),
      },
    },
    commands: { doctor: { describe: "Say what this machine is missing.", run: check } },
  };
}
```

For a platform a person signs in to, use `environment()`. It provides the sign-in, the
vault, the list of accounts with a mode each, the guard and the `doctor`, so the
folder holds only what is particular to the platform: where to sign in, what to ask
for, how to find the accounts, and what each of the platform's tools does. No
environment here carries its own sign-in, storage or approval code. See
[Environments](https://harness.praecise.com/docs/environments/) and
[meta-marketing/index.ts](meta-marketing/index.ts).

Rules every environment here keeps:

- **Few skills.** An agent reads every skill's description in every session. Five
  that are used beat fifty that are not.
- **Small output.** Skills give commands whose output is already filtered, and say
  to run a build or a test once and wait for it, not to poll.
- **No values baked in.** Anything that differs between teams is an option of the
  function and a `{{PLACEHOLDER}}` in the skills.
- **A `doctor` command** that lists what the machine lacks and how to get it.
- **Nothing secret.** No keys, tokens, certificates or profiles in the repository,
  and no step that writes one to disk.
- **Ask first** before anything that leaves the machine: an upload, a submission, a
  change on someone's account.
- **Say what every tool does.** Each of a platform's tools is listed as reading,
  drafting, publishing, sending, spending or destroying. One that is not listed is
  treated as publishing.
- **Only what the platform publishes.** Addresses, scopes and tool names come from the
  platform's own documentation or its live answers, and anything not yet confirmed is
  listed in the environment's README as not done.
- **TypeScript**, with only syntax that can be erased: no enums, no namespaces, no
  parameter properties.
- Add the environment to `exports` in `package.json` and to the table above.

## License

Apache-2.0

## Tests

```sh
node --test --test-concurrency=1 tests/*.test.ts
```

One file at a time: the tests that drive a real browser listen on the one port the
extensions look for. Those, and the tests that need a real app, run only where a
browser or a helper is named, and say how at the top of each file.


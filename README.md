# praecise-environments

Environments for [praecise-harness](https://github.com/Praecise/praecise-harness).

An environment equips agents for one platform or toolchain. It brings the skills
for working on it, the tools that reach it, an agent that knows it, and a command
that says what the machine is missing. To the harness it is a plugin, so an app
takes one with a line in its config.

| Environment | For | Status |
|---|---|---|
| [apple](apple/) | Building, testing, signing and releasing apps for iOS, iPadOS, macOS, tvOS, watchOS and visionOS, with Xcode | 0.1.0 |

## Use one

```
git clone https://github.com/Praecise/praecise-environments
```

In a harness app, add the clone as a dependency (`npm install ../praecise-environments`)
and list the environment:

```ts
import { defineConfig } from "@praecise/harness";
import { apple } from "@praecise/environments/apple";

export default defineConfig({ plugins: [apple({ /* your team's values */ })] });
```

Needs `@praecise/harness` 1.1.0 or later, the first version in which a plugin can
bring skills (`skillsIn`). Needs Node 24, which runs
the TypeScript here as it is. Install from a clone, as above: Node does not run
TypeScript that has been copied into `node_modules`, and a linked folder is not a
copy.

An environment's skills are plain [Agent Skills](https://agentskills.io/specification)
folders, so they also work without the harness. Each environment's README says how
to install it for the tools it supports; `apple/install.sh` does it for Claude Code
and for Claude Agent in Xcode.

## Write one

An environment is a folder here with:

```
<name>/
  index.ts        export a function returning a Plugin
  skills/         one folder per skill, each a SKILL.md
  README.md       what it is for, what it needs, how to use it
```

```ts
import { agent, skillsIn, tool, type Plugin } from "@praecise/harness";

export function android(options: AndroidOptions): Plugin {
  return {
    name: "android",
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
- **TypeScript**, with only syntax that can be erased: no enums, no namespaces, no
  parameter properties.
- Add the environment to `exports` in `package.json` and to the table above.

## License

Apache-2.0

<p align="center">
  <img src="assets/icon.png" width="128" alt="idectl icon">
</p>

<h1 align="center">idectl</h1>

<p align="center">
  <b>Give your AI agent a real debugger.</b><br>
  Breakpoints, stepping, variables and hot reload in your JetBrains IDE, from one command.
</p>

---

## Why

Agents guess at bugs with `print` statements and restarts. You debug with breakpoints. **idectl lets the agent do what you do**: pause the app on a line, look at the real values, step forward, fix the code and reload, without leaving your IDE or your project.

## Get started

```sh
cd your-project
git clone https://github.com/mixinDennisBarzanoffMixin/idectl vendor/idectl
bun install --cwd vendor/idectl
bun vendor/idectl/cli/src/cli.ts doctor
```

That is it. idectl finds your IDEs, installs what it needs into them, and reports what your agent can debug and how. Then ask your agent to debug something.

## What `doctor` checks

| It looks for | And tells you |
|---|---|
| JetBrains IDEs on the machine | which one fits each part of your project |
| The debugger tooling in that IDE | whether it is ready, or installs it |
| Your run configurations | which ones the agent can start under the debugger |
| Your project's services and devices | what is running, what is not, and the command to fix it |

You keep working in your own IDE. The agent drives the same debugger you would.

## Compatibility

**IDEs**

Works with every JetBrains IDE: idectl detects the ones installed and drives the debugger of each (breakpoints, stepping, variables, evaluate).

| IDE | Languages | Project setup (`idectl.json`) | Tried here |
|---|---|---|---|
| IntelliJ IDEA | Java, Kotlin, Scala | Via `--ide` | |
| PyCharm | Python | Via `--ide` | |
| WebStorm | JavaScript, TypeScript, Node, Bun | Built in | Yes |
| GoLand | Go | Via `--ide` | |
| PhpStorm | PHP | Via `--ide` | |
| RubyMine | Ruby | Via `--ide` | |
| CLion | C, C++ | Via `--ide` | |
| RustRover | Rust | Built in | Yes |
| Rider | .NET | Via `--ide` | |
| Android Studio | Dart, Flutter, Android | Built in | Yes, with hot reload and hot restart |
| DataGrip, DataSpell, Aqua | SQL, data science, QA | Via `--ide` | |

"Built in" means you can declare the IDE for a service in `idectl.json` and idectl starts and supervises it for you. "Via `--ide`" means you pick the IDE on the command, for example `idectl debug status --ide pycharm`.

**Agents**

| Agent | Status |
|---|---|
| Claude Code | Supported, ships a skill |
| T3 Code | Supported, including browser preview |
| Any agent that runs shell commands | Works: every command prints JSON |

**Platforms**

| Platform | Status |
|---|---|
| Linux | Supported, IDE plugins install automatically |
| macOS, Windows | Not tested |

## What your agent can do

| Ability | Example |
|---|---|
| Start your app under the debugger | `idectl debug start app` |
| Set a breakpoint | `idectl breakpoint set lib/main.dart 42` |
| See where it stopped and the values | `idectl debug vars --service app` |
| Evaluate an expression | `idectl debug eval "user.name" --service app` |
| Step and resume | `idectl debug resume --service app` |
| Apply edits without losing the session | `idectl debug reload` |
| Run several services in one session | server and mobile app together |

## Talk to it in plain words

> "Put a breakpoint where the greeting is sent, tap Send in the app, and tell me what the name is on the server."

The agent sets both breakpoints, triggers the tap, reads the values at each pause and resumes.

## For agents and contributors

Configuration, adapters, the plugin and the full command model are in [AGENTS.md](AGENTS.md). The debugging workflow is in [docs/debugging.md](docs/debugging.md).

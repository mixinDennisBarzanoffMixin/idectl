# idectl: technical reference for agents and contributors

User-facing overview: [README.md](README.md). Debugging workflow: [docs/debugging.md](docs/debugging.md).

Command-line control of JetBrains IDE debugging for agents and scripts: open projects, launch run configurations, set breakpoints, step, inspect variables, and run supervised debug sessions whose local processes replace or receive traffic from a shared environment.

- `cli/`: the `idectl` CLI (Bun). All output is JSON.
- `plugin/`: the JetBrains lifecycle plugin. The CLI builds it from this directory and installs it into each IDE it opens: 263-series JetBrains IDEs share one build made with the installed RustRover; any other IDE (Android Studio, an IDE on another platform build) gets a build made against itself.
- `example/`: a standalone project using the `none` adapter; the test suite runs against it.
- `docs/debugging.md`: the debugging workflow. `skill/SKILL.md` is an agent skill that points at it.

## Project config

`idectl` finds `idectl.json` in the current directory or a parent. It declares:

- `env`: dotenv file with ports and URLs referenced by name below.
- `state`: per-checkout state directory.
- `preflight` (optional): command that must exit 0 before the environment is touched.
- `hooks.runtime` (optional): reads `{service, configuration, port, dir, paths, env}` as JSON on stdin and prints the final environment object. Progress goes to stderr; it may write its phase to `$IDECTL_PHASE`.
- `hooks.login` (optional): reads `IDECTL_URL` and prints `{"cookies":[{"name","value"}]}` for the managed browser.
- `adapter`: the environment the local processes join.
- `frontend` (optional) and `services`: run configuration name, IDE project path, health path, port variable, workload and routing `mode`. Each service also names its `ide`: `rustrover` runs a built Rust `binary`; `webstorm` runs a Node or Bun run configuration (no `binary`), whose process idectl recognises by its working directory inside the project; `android-studio` runs a Dart or Flutter run configuration.
- Omit `frontend` when there is no browser-hosted app (a mobile app, a server-only project); managed sessions (`debug up`) and browser checks then report that they need one. With the `none` adapter the routing fields (`workload`, `container`, `agent`, `mode`) may be omitted, and so may `health` and `port` for a process that serves nothing.
- A Flutter service may set `device` to an env-file variable holding the device id its configuration launches on (`debug start NAME --device ID` overrides it). The Flutter plugin ignores a device named in the run configuration, so idectl selects it in the IDE first.
- A Dart service may set `vmService` to the file its VM writes its service URI to (add `--write-service-info=FILE` to the run configuration's `VMOptions`). `debug reload` then hot-reloads that process while the debugger stays attached.

## Adapters

- `none`: local processes only. Routing is a no-op.
- `kubernetes`: resolves a workload container's env, Secrets, ConfigMaps and the checkout's hostPath mount from the cluster, and routes with Telepresence:
  - `mode: "intercept"` sends the workload's HTTP traffic to the local process while cluster pods keep running.
  - `mode: "replace"` stops the workload's container (`telepresence replace`) before the local process starts and restores it after the local process stops. Use it for queue workers. Telepresence `timeouts.intercept` (client config) and the traffic manager's `timeouts.agentArrival` (Helm value) must be at least 2m because the workload restarts and may wait for its disruption budget; `idectl doctor` checks both.

Replace-mode services only start through `idectl debug up NAME`, which owns the stop-and-restore.

## Dart and Flutter

A component with a `pubspec.yaml` opens in Android Studio. Every member of a pub workspace shares one generated IDE project rooted at the workspace, with the Dart SDK taken from the Flutter (or Dart) on `PATH`. Android Studio does not bundle the MCP Server plugin or the debugger: idectl installs both from the Marketplace with the IDE's own `installPlugins` while the IDE is stopped. Run configurations in `.run` of type `DartCommandLineRunConfigurationType`, `FlutterRunConfigurationType` and `DartTestRunConfigurationType` are copied into the project. `debug start NAME`, `breakpoint set FILE.dart LINE`, `debug wait|vars|eval|resume --service NAME` then work as for other IDEs.

## Use

```sh
idectl doctor --service NAME
idectl debug up NAME && idectl wait session NAME
idectl breakpoint set path/to/file.rs 42
idectl debug down NAME && idectl wait session NAME --until stopped
```

`idectl --help` lists every command.

## Develop

```sh
bun install
bun run typecheck
bun test ./cli/test
```

Plugin: `cd plugin && JAVA_HOME=IDE_PATH/jbr ./gradlew buildPlugin -PidePath=IDE_PATH`. `plugin/README.md` describes the tools it adds to the JetBrains MCP server.

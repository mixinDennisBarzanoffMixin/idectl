# Debugging with idectl

Commands below are written as `idectl`; use the project's `cli` entry from `idectl.json` (for example `./script/idectl`). Every command prints JSON on stdout and errors as JSON on stderr. `idectl --help` lists the syntax.

## IDEs and the plugin

`idectl open PATH` selects WebStorm, RustRover or Android Studio (a component with a `pubspec.yaml`) for the component, generates a small IDE project, and waits up to 20s; exit 2 means it is still starting. A Rust project indexes its whole Cargo workspace, so sibling crates are searchable.
`open` installs the lifecycle plugin (built from this repository's `plugin/` with the installed RustRover) and the Debugger MCP plugin. The first build runs in the background: `wait plugin --ide rustrover --json`, then repeat `open`. An IDE already running with an older plugin must be closed before it can install. `plugin retry` retries a failed build after you fix the cause in its log. Automatic installation supports Linux and 263-series IDEs.
`doctor` checks the IDE, both MCP servers, the plugin, the selected project and the environment adapter. With several open projects it returns `selection_required` and the exact commands to choose one; `doctor --service NAME` selects a service's project.
Shared run configurations in the checkout's `.run` are copied into the IDE project; `open` reloads them in an already-open project. They contain no environment values.

## Managed sessions

`idectl debug up NAME`, then `wait session NAME --json`, starts the frontend in WebStorm and the service in RustRover, routes the environment's frontend and service traffic to them, opens the browser at the configured URL and runs the login hook. The wait returns as soon as the session is ready, paused or failed (60s maximum; `--timeout` for shorter checks).
The ready result includes a `preview` recipe: call T3 `preview_status`, then `preview_open` with `preview.arguments`, even when status says `available:false` and `tabId:null`. Read controls with `preview_snapshot` and click with `preview_act({action:"click",tabId,locator:"aria-ref=<ref>"})`. `debug browser --service NAME` returns the recipe again. Use the ready result's `browser.context` arguments for frontend debugger commands, including breakpoints in shared frontend source.
If a startup breakpoint pauses a service, the wait reports `paused` and the resume command.
Only one managed session can own the frontend at a time. Existing debug processes and routes are reused and left running.
`debug down NAME`, then `wait session NAME --until stopped --json`, cleans up: `cleanup` goes `requested`, `running`, `complete`. Cleanup closes the owned browser, stops owned debug sessions, removes owned routes and persists IDE breakpoint settings. Each launch and stop reports its creation timestamp so retries can be identified.

A service's `ide` (`idectl.json`) chooses its debugger: RustRover for Rust binaries, WebStorm for Node and Bun run configurations. `--service NAME` selects that IDE and project; everything else on this page applies to both.

Routing modes, from each service's `mode`:

- `intercept`: the environment keeps its own copy running while its traffic goes to the IDE process. Use `route NAME` / `unroute NAME` to do this manually once a local service is ready.
- `replace`: the environment's copy is stopped before the local process starts and restored after it stops. While it waits, the session's `detail` reports the workload's pods, so a disruption-budget wait is distinguishable from a stall. Use it for queue workers. Only `debug up NAME` starts such a service, because the session owns the stop and restore; other launches return `environment_repair_required`. That error means stop and request repair, not retry or launch manually.

To trigger and track a request across a breakpoint, run `debug request NAME /PATH`. It returns an ID immediately; inspect the pause, resume, then `wait request ID --json` reads that response. Requests are GETs and stay pending while the session is active; `--timeout` sets a limit up to 60s.

## Services without a session

Use the CLI to launch services: the IDE's Run button does not apply the environment, file-backed credentials or routing.
`debug start NAME` returns a supervised job immediately; `debug jobs --ide rustrover` shows preparation, `compiling` while Cargo is active, then the running session and readiness. `debug cancel NAME --ide rustrover` stops it, and its private credential files are removed after the process stops. `wait NAME --json` exits 0 when ready, 2 while starting or paused, and 1 if it failed or stopped. If the supervisor exits, `debug recover NAME --ide rustrover` reattaches only when it can identify the original build or session; check `debug jobs` before retrying.
Start the frontend alone with `debug start frontend --ide webstorm` and stop it with `debug cancel frontend --ide webstorm`.
IDE lifecycle IDs and debugger session IDs are distinct. A launch timeout means the outcome is unknown: check `jetbrains status` or `debug sessions` before starting again. An IDE build can run before a debugger session appears; `debug builds --ide rustrover` shows it.

`debug start NAME` accepts a service name for any IDE: it runs the project's preflight, then starts that service's run configuration under the debugger. For a Flutter configuration it first selects the service's `device` (or `--device ID`) in the IDE. A Flutter session is named after its device ("App (Pixel 8)"); `--service NAME` still selects it.

`debug reload` applies edits made on disk without ending debug sessions: running Flutter apps hot-reload through the Flutter plugin (the IDE re-reads the files first), and each Dart service with `vmService` reloads through its VM service. `--service NAME` limits it to one; `debug restart` hot-restarts Flutter apps. Breakpoints stay set. In a Dart run configuration the options are named `VMOptions` and `arguments`; other names are ignored without an error.

## Breakpoints and inspection

Arm breakpoints before triggering the operation. In JavaScript and TypeScript a line breakpoint binds to the first statement on its line: break inside a named method or a multi-line handler body, since a one-line arrow function or an object literal binds to its registration, which already ran. Set request breakpoints inside the registered handler; router construction runs at startup. To find which handler a UI action calls, set a `--once` breakpoint in the service's shared request middleware, trigger the action, read the path with `debug text` (below), resume, then break in that route's handler. Optional JSON arguments are read from stdin only when you pass `-`. `breakpoint set FILE LINE --once` is consumed at the first hit; resume before rearming it. `--condition EXPRESSION` narrows shared code; in Rust prefer scalar fields, since string equality or method calls may not evaluate, and an accepted condition is not proof of evaluation. Rust files select RustRover automatically.
Both IDEs use `debug status|wait|stack|vars|eval|step-over|resume|stop`; `--service NAME` selects the service's project and active session, `--session ID` another session. Commands without a file or service need `--project`, `--ide`, `--service` or `--port`.
`debug inspect` returns the stack and frame variables; `debug vars` lists the selected frame's variables, including WebStorm scope groups. While WebStorm is paused, select its browser session with `--ide webstorm --session ID` and inspect before resuming; a paused page cannot run JavaScript.
Steps wait for the resulting pause. Frontend steps and waits return early when the related managed backend is paused, with inspect and resume commands. Rust steps use native IDE actions and recover through library and line-zero stops within the deadline and a 32-step limit; breakpoints, exceptions and thread changes stop recovery, and `filtering` reports what was skipped. Raw `mcp call step_into|step_over|step_out` bypasses this.
Native Rust evaluation reads fields but cannot call methods such as `uri().path()`. Descend through fields until a scalar appears; an enum's variant is in the result's `type`: `debug eval request.head.method.0 --service NAME` returns type `Inner::Get` for an axum request's method. For text stored as a pointer and length, `debug text POINTER LENGTH` decodes up to 256 bytes, for example `debug text request.head.uri.path_and_query.data.bytes.ptr request.head.uri.path_and_query.data.bytes.len --service NAME` for an axum request path. Avoid expanding header maps, which can contain credentials.
To cross a Rust `.await`, prefer a breakpoint on the next application statement, then resume and wait. Async stepping can revisit a line and the same worker thread can run different requests, so check request values at each stop.
On a `debug wait` timeout the CLI reports the app mount state, enabled breakpoint count and browser error groups; pass `--url URL` if the browser configuration does not identify its URL.
Remove stale session-owned breakpoints; preserve disabled IDE-default or user-owned exception breakpoints.

## JetBrains tools

`jetbrains tools [FILTER]` lists the IDE's tools, `jetbrains schema TOOL` shows arguments, and `jetbrains call TOOL JSON` calls one (`-` reads JSON from stdin, `--full` removes the output limit, `--timeout SECONDS` changes the deadline). Use `search_text` or `search_symbol` to locate code; `paths` filters are relative to the generated project's content root (for Rust, the Cargo workspace, so `server/src/**` rather than `src/**`), and omitting them searches everything. Then read code with ordinary file tools: the IDE's `read_file` can elide lines despite `offset` and `limit`, and its file tools only see the generated project's content root, so pass absolute paths. `debug commands [TOOL]` lists debugger tools with their CLI aliases; raw tool names use underscores.

## Browser checks

### Processes a service spawns itself

A service that starts short-lived child processes (a Node driver per request) cannot be attached to by the IDE that runs the service. Declare the child's debugger in `idectl.json` and have the spawner read its inspect port from the declared file:

```json
"attach": { "drivers": { "project": "packages/x/drivers", "configuration": "Drivers", "port": "9229", "file": ".state/inspect" } }
```

The configuration is a WebStorm `ChromiumRemoteDebugType` run configuration on that port with `restartOnDisconnect="true"`, so one session catches every process the service spawns. `debug attach NAME` writes the port file, opens the project and starts the session; `debug detach NAME` removes the file first, then stops the session through `idectl_run_stop`. Stop it only that way: the debugger API's stop is treated as a dropped connection and the session reconnects. Spawned processes pause at start until a debugger connects, so always detach.

To debug a browser without a session, either `open PATH --url URL` and start the returned configuration, then pass its `browser.endpoint` as `debugEndpoint` to T3 `preview_open`; or open a T3 debug browser first and pass its endpoint to `open PATH --url URL --attach ENDPOINT`.
`ready PATH --url URL` checks each stage through the app's first render, using the frontend's `mounted` expression. It proves rendered content, not authentication or backend readiness.
`test browser --ide webstorm --project PROJECT --url URL` reloads the app and exercises a breakpoint, inspection and a step; it needs a running session with no enabled breakpoints and resumes it afterwards.

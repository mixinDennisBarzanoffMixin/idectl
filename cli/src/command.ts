import fs from "node:fs"
import path from "node:path"
import { unbound } from "./lines"
import { observe, step } from "./stepping"
import { dispatch } from "./jetbrains"
import { root, ides, object, print, attempt, launcher, input, opened, rows, runs, field } from "./core"
import { cfg, needFrontend, known, service as find } from "./config"

const bin = cfg.cli
import { adapter } from "./adapter"
import { launchenv } from "./setup"
import { lifecycle } from "./lifecycle"
import { debuggerClient } from "./debugger"
import { doctor } from "./doctor"
import { checks } from "./checks"
import { kill, preflight, attach, detach, vars } from "./service"
import { enqueue, jobs, cancel, recover, wait, service, managed, launchable } from "./job"
import { retry as retryPlugin, wait as waitPlugin } from "./plugin"
import { up as sessionUp, down as sessionDown, wait as sessionWait, browser as sessionBrowser, context as sessionContext, matching as sessionMatching, owner as sessionOwner, blocked as sessionBlocked } from "./session"
import { start as requestStart, wait as requestWait } from "./request"
import { scope as projectScope } from "./project"
import { on as attachOn, off as attachOff } from "./attach"
import { keep, install, uninstall } from "./keep"

const args = process.argv.slice(2)

function option(name: string) {
  const inline = args.findIndex((arg) => arg.startsWith(`${name}=`))
  if (inline !== -1) return args.splice(inline, 1)[0].slice(name.length + 1)
  const pos = args.indexOf(name)
  if (pos === -1) return
  const value = args[pos + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  args.splice(pos, 2)
  return value
}

function flag(name: string) {
  const pos = args.indexOf(name)
  if (pos === -1) return false
  args.splice(pos, 1)
  return true
}

const explicit = option("--ide")
const override = option("--port")
const explicitSession = option("--session")
const selected = option("--project")
const scope = option("--service")
const backend = scope && known(scope) ? find(scope).ide : undefined
if (scope && backend && (explicit && explicit !== backend || override)) throw new Error(`--service selects ${backend}; do not combine it with a different IDE or port`)
const context = scope ? sessionContext(scope) : (!explicit || explicit === "rustrover") && args[0] === "breakpoint" && args[1] === "set" && args[2] ? sessionMatching(args[2]) : undefined
const project = selected ? (path.resolve(selected).startsWith(`${root}${path.sep}`) || path.resolve(selected) === root ? projectScope(root, selected).project : path.resolve(selected)) : context?.project
const job = scope && context && (!selected || project === context.project)
  ? jobs(context.project).find((item) => item.name === service(scope) && ["running", "paused"].includes(String(item.phase)))
  : undefined
const session = explicitSession || (typeof job?.session === "string" || typeof job?.session === "number" ? String(job.session) : undefined)
const web = args[0] === "debug" && ["start", "cancel"].includes(args[1] || "") && args[2] === "frontend"
const byFile: Record<string, string> = { ".rs": "rustrover", ".dart": "android-studio" }
const chosen = explicit || (scope ? backend : args[0] === "breakpoint" && args[1] === "set" && byFile[path.extname(args[2] || "")] ? byFile[path.extname(args[2] || "")] : web ? "webstorm" : undefined)
const timeout = option("--timeout")
const until = option("--until")
const frame = option("--frame")
const details = flag("--inspect")
const full = flag("--full")
const once = flag("--once")
const condition = option("--condition")
flag("--json")
const device = option("--device")
const url = option("--url")
const remote = option("--attach")

function index() {
  if (!frame) return 0
  const value = Number(frame)
  if (!Number.isInteger(value) || value < 0) throw new Error("--frame must be a non-negative integer")
  return value
}


const debug = debuggerClient({ chosen, override, session: scope ? explicitSession : session, project, configuration: scope && context && (!selected || project === context.project) ? service(scope) : undefined })
const { launchedBrowser, endpoints, endpoint, tool, config, launch } = debug
const { smoke, readiness, diagnosis, browserSmoke, values, pause, snapshot, frontend } = checks(debug, { project, url })

const names = Object.keys(cfg.services).join("|")
const usage = `${bin} doctor [--ide ID] [--port PORT]
${bin} plugin retry
${bin} ready PATH --url URL
${bin} wait plugin|frontend|${names} [--timeout SECONDS] [--json]
${bin} ides
${bin} ide install|uninstall webstorm|rustrover   (run the IDE as a systemd user service from boot)
${bin} connect
${bin} env SERVICE   (WebStorm services: the launch environment as JSON, for script/ide wrappers)
${bin} open PATH [LINE] [--ide ID] [--url URL] [--attach ENDPOINT]
${bin} close PATH | close --project PATH
${bin} route|unroute frontend|${names}
${bin} breakpoint set FILE LINE [--once] [--condition EXPRESSION] [JSON] | list | remove ID
${bin} debug browser|configs|sessions|status|wait|inspect|vars|stack|source|console|threads|frame [...]
${bin} debug reload|restart   (apply edits on disk to running Flutter apps and Dart servers; debug sessions and breakpoints stay)
${bin} debug up|down ${names}
${bin} debug attach|detach ${Object.keys(cfg.attach).join("|")}   (processes a service spawns itself: write the inspect port file and attach WebStorm)
${bin} debug request SERVICE /PATH [--timeout SECONDS]
${bin} wait session SERVICE [--until ready|stopped] [--timeout SECONDS] [--json]
${bin} wait request ID [--timeout SECONDS] [--json]
${bin} debug resume|pause|step-over|step-into|step-out|eval|set|start|run|stop [...]
${bin} debug text POINTER LENGTH
${bin} debug jobs | builds | cancel|recover CONFIGURATION --ide rustrover
${bin} debug commands [TOOL] | TOOL [JSON|-]
${bin} mcp tools | call TOOL [JSON|-]
${bin} jetbrains tools [FILTER] | schema TOOL | call TOOL [JSON|-] [--timeout SECONDS]
${bin} jetbrains status | configs | output [SESSION] | tree PATH [DEPTH]   (tree: expand a paused value, e.g. self.source 4)
${bin} test breakpoint
${bin} test browser --project PATH --url URL

Services and the ${adapter.type} environment come from ${path.join(cfg.root, "idectl.json")}.
Use --service NAME for a Rust service's project and debugger, --project PATH to select its recorded IDE, --session ID for a specific session, and --frame N for a stack frame. Rust breakpoint files select RustRover automatically.
At a frontend pause, select the browser session and inspect variables before resuming; raw MCP tool names use underscores.
Attach managed browsers with T3 preview_status then preview_open using preview.arguments; available:false with tabId:null means open the preview, not an attachment failure.
Use debug browser --service NAME to retrieve that managed session's verified browser attachment recipe.
Read the attached tab with T3 preview_snapshot and click its controls with T3 preview_act (action=click, tabId, locator=aria-ref); discover preview_act by name if needed.
open selects the component's IDE and waits up to 20s; exit 2 means it is still starting. close stops launcher-owned IDEs.
JetBrains tools are listed by name; use schema for details and --full for unbounded output.
Native Rust uses RustRover run configurations; discover these with debug configs, then debug start NAME.
Waits return immediately when their condition is met, with a default maximum of 60s; --timeout sets a shorter maximum. Steps wait for the next pause.
All result data is JSON on stdout. Errors are JSON on stderr.`

export async function main() {
  const group = args.shift()
  if (!group || group === "help" || group === "--help" || group === "-h" || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  if (group === "doctor") {
    const value = await doctor(debug, { chosen, project, source: context?.source, service: scope })
    print(value)
    return value.ok ? 0 : 1
  }
  if (group === "plugin") {
    if (args.shift() !== "retry" || args.length) throw new Error("plugin expects retry")
    print(retryPlugin())
    return 0
  }
  if (group === "ready") {
    const target = args.shift()
    if (!target) throw new Error("ready requires a component path")
    const value = await readiness(target)
    print(value)
    return value.ok ? 0 : 1
  }
  if (group === "wait") {
    const name = args.shift()
    if (name === "request") {
      const id = args.shift()
      if (!id || args.length) throw new Error("wait request requires one request ID")
      const result = await requestWait(id, timeout ? Number(timeout) : 60)
      print(result)
      return result.ok ? 0 : "phase" in result && result.phase === "waiting" ? 2 : 1
    }
    if (name === "session") {
      const service = args.shift()
      if (!service || args.length) throw new Error("wait session requires one service name")
      const result = await sessionWait(service, timeout ? Number(timeout) : 60, until)
      print(result)
      return result.ok ? 0 : ["waiting", "stopping", "paused"].includes(String(result.phase)) ? 2 : 1
    }
    if (!name || args.length) throw new Error("wait requires one service name")
    if (name === "plugin") {
      const ide = ides.find((item) => item.id === (chosen || "rustrover"))
      if (!ide) throw new Error(`Unknown IDE ${chosen}`)
      const bin = launcher(ide)
      if (!bin) throw new Error(`${ide.name} is not installed`)
      const result = await waitPlugin(ide, bin, timeout ? Number(timeout) : 60)
      print(result)
      return result.ok ? 0 : result.phase === "plugin_failed" ? 1 : 2
    }
    if (name === "frontend") {
      const result = await frontend(timeout ? Number(timeout) : 60)
      print(result)
      return result.ok ? 0 : ["waiting", "paused"].includes(String(result.phase)) ? 2 : 1
    }
    if (!chosen && !project && !override && managed(name)) {
      const current = sessionContext(name).state
      if (current && !["stopped", "failed"].includes(String(current.phase))) {
        const result = await sessionWait(name, timeout ? Number(timeout) : 60)
        print(result)
        return result.ok ? 0 : ["waiting", "stopping", "paused"].includes(String(result.phase)) ? 2 : 1
      }
    }
    const ide = (await endpoints()).find((item) => item.id === "rustrover")
    if (!ide) throw new Error("RustRover is not running; open the service's source first")
    const target = project ? path.resolve(project) : opened(ide)
    if (!target) throw new Error("No RustRover project selected; open the service's source first")
    const result = await wait(name, target, timeout ? Number(timeout) : 60)
    print(result)
    return result.ok ? 0 : ["waiting", "paused"].includes(String(result.phase)) ? 2 : 1
  }
  if (group === "ide") {
    const action = args.shift()
    const id = args.shift()
    if (!id || args.length || !["keep", "install", "uninstall"].includes(action || "")) throw new Error("ide expects keep|install|uninstall IDE")
    if (action === "keep") await keep(id, endpoints)
    else print(action === "install" ? await install(id) : await uninstall(id))
    return 0
  }
  if (group === "ides") {
    const active = await endpoints()
    print(
      ides.map((ide) => {
        const bin = launcher(ide)
        const live = active.find((item) => item.id === ide.id)
        return {
          id: ide.id,
          installed: Boolean(bin),
          launcher: bin,
          port: ide.port,
          pid: live?.pid,
          active: Boolean(live),
          tools: live?.tools.length,
        }
      }),
    )
    return 0
  }
  if (group === "env") {
    const name = args.shift()
    if (!name || args.length || !known(name) || find(name).ide !== "webstorm") throw new Error("env requires the name of a WebStorm service")
    // Secrets reach the caller on stdout only; its wrapper applies them in memory and removes dir.
    print(await launchenv(name))
    return 0
  }
  if (group === "connect") {
    await preflight()
    print({ ok: true, adapter: adapter.type, ...(await adapter.connect()) })
    return 0
  }
  if (group === "open" || group === "launch") {
    const value = await lifecycle({ project, chosen, attach: remote, url, endpoints, tool, kill }).open(args)
    print(value)
    if (value.phase === "plugin_failed") return 1
    return value.ok ? 0 : 2
  }
  if (group === "close") {
    const value = await lifecycle({ project, chosen, attach: remote, url, endpoints, tool, kill }).close(args)
    print(value)
    return value.ok ? 0 : 2
  }
  if (group === "route" || group === "unroute") {
    const name = args.shift()
    if (!name || args.length) throw new Error(`${group} expects frontend|${names}`)
    const item = name === "frontend" ? needFrontend() : find(name)
    if (group === "route" && item.mode === "replace") launchable(name, false)
    print(group === "route" ? await attach(item) : await detach(item))
    return 0
  }
  if (group === "mcp") {
    const ide = await endpoint()
    const action = args.shift()
    if (action === "tools") print(full ? ide.tools : ide.tools.map((item) => item.name))
    else if (action === "call") {
      const name = args.shift()
      if (!name) throw new Error("mcp call requires a tool name")
      print(await tool(ide, name, await input(args), 30_000))
    } else throw new Error("mcp expects tools|call")
    return 0
  }
  if (group === "jetbrains" || group === "jb") {
    return dispatch(await endpoint(), args, { project, timeout, full, session, frame: index() })
  }
  if (group === "breakpoint") {
    const ide = await endpoint()
    const action = args.shift()
    if (action === "set") {
      const target = args.shift()
      const line = Number(args.shift())
      if (!target || !Number.isInteger(line) || line < 1) throw new Error("breakpoint set requires FILE LINE")
      const ext = path.extname(target)
      const owner = byFile[ext] || ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext) ? "webstorm" : undefined)
      if (owner && owner !== ide.id)
        throw new Error(`${target} belongs in ${owner}, but this selector chose ${ide.id}; use breakpoint set ${target} ${line}${once ? " --once" : ""} --ide ${owner} without --service`)
      // --service names a backend that already selected its own project; the browser-project rule is for frontend files.
      const managed = ide.id === "webstorm" && !scope ? sessionOwner() : undefined
      if (managed) {
        const current = project || (await attempt(async () => opened(ide))).value
        // An attach project holds source for processes a service spawns; it is never the managed browser project.
        const attached = Object.values(cfg.attach).some((item) => projectScope(root, item.project).project === current)
        if (current !== managed.project && !attached)
          throw new Error(`The managed ${managed.service} browser belongs to ${managed.project}; set frontend breakpoints using ${managed.context.join(" ")}. Shared-source breakpoints belong to this browser project too.`)
      }
      const opts = await input(args)
      if (condition !== undefined) {
        if (!condition.trim()) throw new Error("--condition requires a nonempty expression")
        if (opts.condition !== undefined) throw new Error("Pass the condition with --condition or JSON, not both")
        opts.condition = condition
      }
      const result = await tool(ide, "set_breakpoint", { ...opts, ...(once ? { temporary: true } : {}), file_path: path.resolve(root, target), line })
      const text = owner === "webstorm" ? fs.readFileSync(path.resolve(root, target), "utf8").split("\n")[line - 1] : undefined
      const why = text === undefined ? undefined : unbound(text)
      print(object(result) ? {
        ...result,
        ...(why ? { warning: `Line ${line} will probably never pause: ${why}. The IDE still reports the breakpoint as set.` } : {}),
        binding: "unknown",
        bindingNote: "IDE acceptance does not prove binding or runtime condition evaluation; inspect the paused location and locals to identify the request.",
        hint: opts.condition === undefined
          ? "An unconditional breakpoint can catch background work; use --condition EXPRESSION to narrow the request, then trigger the action and inspect the pause."
          : "Trigger the action after setting breakpoints; adding a breakpoint while paused does not advance execution, so resume or step to it and inspect the next pause before judging the request.",
      } : result)
    } else if (action === "list") print(await tool(ide, "list_breakpoints"))
    else if (action === "remove") {
      const id = args.shift()
      if (!id) throw new Error("breakpoint remove requires an ID")
      print(await tool(ide, "remove_breakpoint", { breakpoint_id: id }))
    } else throw new Error("breakpoint expects set|list|remove")
    return 0
  }
  if (group === "debug") {
    const action = args.shift()
    if (action === "request") {
      const name = args.shift()
      const route = args.shift()
      if (!name || !route || args.length) throw new Error("debug request requires SERVICE /PATH")
      print(await requestStart(name, route, timeout ? Number(timeout) : undefined))
      return 0
    }
    if (action === "up" || action === "down") {
      const name = args.shift()
      if (!name || args.length) throw new Error(`debug ${action} requires one service name`)
      print(action === "up" ? sessionUp(name) : sessionDown(name))
      return 0
    }
    if (action === "attach" || action === "detach") {
      const id = args.shift()
      if (!id || args.length) throw new Error(`debug ${action} requires one attach name (${Object.keys(cfg.attach).join("|")})`)
      print(action === "attach" ? await attachOn(id) : await attachOff(id))
      return 0
    }
    if (action === "browser" && scope) {
      if (args.length || explicit || selected || explicitSession) throw new Error("A managed browser is selected by --service NAME; omit positional arguments, --ide, --project and --session")
      print(await sessionBrowser(scope))
      return 0
    }
    const rust = action && ["start", "cancel", "recover"].includes(action) && managed(args.join(" ").trim())
    const ide = !chosen && !override && rust ? (await endpoints()).find((item) => item.id === find(args.join(" ").trim()).ide) : await endpoint()
    if (!ide) throw new Error("The service's IDE is not running; open the service's source first")
    if (ide.id === "rustrover") {
      if (!action) throw new Error("debug requires a command")
      if (action === "run") throw new Error("Use debug start for Rust so runtime setup is applied")
      if (action === "builds") return dispatch(ide, [action, ...args], { project, timeout, full, session, frame: index() })
      if (["start", "jobs", "cancel", "recover"].includes(action)) {
        const name = service(args.join(" ").trim())
        const target = project ? path.resolve(project) : name && managed(name) ? sessionContext(args.join(" ").trim()).project : opened(ide)
        if (!target) throw new Error("No IDE project selected; open a project or pass --project")
        if (action === "jobs") { print({ jobs: scope ? jobs(target).filter((item) => item.name === service(scope)) : jobs(target) }); return 0 }
        if (!name) throw new Error(`debug ${action} requires a configuration name`)
        if (action === "start") { print(enqueue(name, target)); return 0 }
        if (action === "recover") { print(recover(name, target)); return 0 }
        print(cancel(name, target))
        return 0
      }
    }
    if (action === "browser") {
      print(await launchedBrowser(ide))
      return 0
    }
    if (action === "reload" || action === "restart") {
      // Edits made on disk reach the running processes without ending their debug sessions: Flutter apps through the
      // Flutter plugin, Dart servers (services with "vmService") through the VM's own reload. --service limits it to one.
      const restart = action === "restart"
      const picked = scope ? [find(scope)] : Object.values(cfg.services).filter((item) => item.ide === ide.id)
      const servers = restart ? [] : picked.filter((item) => item.vmService)
      const dart = await Promise.all(servers.map(async (item) => ({ service: item.configuration, ...(await debug.dartReload(path.resolve(root, item.vmService!))) })))
      const flutter = !scope || !find(scope).vmService ? await debug.flutterReload(ide, restart) : undefined
      const ok = dart.every((item) => item.ok) && (flutter === undefined || (object(flutter) && flutter.reloaded === true))
      print({ ok, ...(dart.length ? { dart } : {}), ...(flutter === undefined ? {} : { flutter }) })
      return ok ? 0 : 1
    }
    if (action === "cancel") {
      const name = args.join(" ").trim()
      const target = name === "frontend" ? needFrontend().configuration : name === "browser" ? needFrontend().browser : service(name)
      if (!target) throw new Error("debug cancel requires a configuration name")
      const sessions = rows(await tool(ide, "list_debug_sessions"), "sessions")
        .filter((item) => runs(item, target) && ["running", "paused"].includes(String(item.state)))
      if (!sessions.length) { print({ ok: true, name: target, phase: "stopped" }); return 0 }
      if (sessions.length !== 1) throw new Error(`Multiple sessions for ${target}; select --session ID and use debug stop`)
      const id = field(sessions[0], ["id", "sessionId"])
      if (!id) throw new Error("Debug session has no ID")
      print(await tool(ide, "stop_debug_session", { session_id: id }))
      return 0
    }
    const map: Record<string, string> = {
      configs: "list_run_configurations",
      sessions: "list_debug_sessions",
      status: "get_debug_session_status",
      resume: "resume_execution",
      pause: "pause_execution",
      "step-over": "step_over",
      "step-into": "step_into",
      "step-out": "step_out",
      stop: "stop_debug_session",
    }
    if (action === "commands") {
      const aliases: Record<string, string> = {
        ...map, vars: "get_variables", eval: "evaluate_expression", stack: "get_stack_trace",
        source: "get_source_context", threads: "list_threads", frame: "select_stack_frame",
        console: "get_console_output", set: "evaluate_expression", wait: "wait_for_pause",
        start: "start_debug_session", run: "execute_run_configuration",
        "breakpoint set": "set_breakpoint", "breakpoint list": "list_breakpoints", "breakpoint remove": "remove_breakpoint",
      }
      const query = args.join(" ").trim()
      if (query === "inspect") throw new Error("debug inspect combines status, stack and variables; use debug inspect --help for CLI syntax, or debug commands status|stack|vars for individual tool schemas")
      if (query === "breakpoint") throw new Error("Choose debug commands breakpoint set, breakpoint list, or breakpoint remove")
      const name = query ? aliases[query] || query.replaceAll("-", "_") : undefined
      if (name && !ide.tools.some((item) => item.name === name)) throw new Error(`Unknown debugger command ${query}; use debug commands with the same selectors to list available commands`)
      print(
        ide.tools
          .filter((item) => !name || item.name === name)
          .map((item) => ({
            command: typeof item.name === "string" ? item.name.replaceAll("_", "-") : item.name,
            cli: Object.entries(aliases).filter(([, tool]) => tool === item.name)
              .map(([alias]) => `${bin} ${alias.startsWith("breakpoint ") ? "" : "debug "}${alias}`),
            description: name ? item.description : undefined,
            inputSchema: name ? item.inputSchema : undefined,
          })),
      )
      return 0
    }
    if (action && ["step-over", "step-into", "step-out"].includes(action)) {
      const seconds = timeout ? Number(timeout) : 60
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error("Step timeout must be 1..60 seconds")
      const params = await input(args)
      const before = await tool(ide, "get_debug_session_status", {
        session_id: params.session_id, project_path: params.project_path,
        include_variables: false, include_source_context: false, max_stack_frames: 1,
      })
      if (!object(before) || before.state !== "paused") throw new Error("Stepping requires a paused session; an earlier step may still be running. Check debug status and wait for its pause before issuing another step.")
      const id = field(before, ["sessionId"])
      if (!id) throw new Error("Paused debugger session has no ID")
      if (ide.id === "rustrover" && typeof before.name !== "string") throw new Error("Paused native session has no configuration name")
      const execution = await step({
        action: map[action], seconds,
        blocked: ide.id === "webstorm" ? () => sessionBlocked(id) : undefined,
        params: { ...params, session_id: id },
        call: (name, args, timeout) => tool(ide, name, args, timeout),
        filter: ide.id === "rustrover" ? () => debug.filter(ide, String(before.name), params.project_path) : undefined,
      })
      const result = execution.result
      const waited = execution.waited
      const same = object(waited) && object(before.currentLocation) && object(waited.currentLocation)
        && before.currentLocation.file === waited.currentLocation.file && before.currentLocation.line === waited.currentLocation.line
      print(object(waited) ? {
        ...pause(waited),
        from: before.currentLocation,
        filtering: execution.filtering,
        blocking: object(waited) ? waited.blocker : undefined,
        action,
        result,
        hint: object(waited.blocker) ? waited.blocker.hint
          : execution.filtering?.interruption === "native"
          ? "The native debugger reported an interruption; automatic recovery stopped. Inspect debug threads and debug stack with the same selectors before continuing."
          : execution.filtering?.outcome === "thread_changed"
          ? "The debugger stopped on a different thread; inspect its stack and request identifiers before continuing rather than assuming it is the original request."
          : execution.filtering && ["limit", "deadline"].includes(execution.filtering.outcome)
          ? "Automatic filtering stopped at its safety boundary; inspect debug status and the current frame before continuing."
          : waited.state === "stopped"
          ? "The debugger reported this session stopped; check debug sessions and debug jobs with the same selector before relaunching."
          : waited.state === "paused" && waited.pausedReason === "breakpoint"
          ? "A breakpoint interrupted the step; inspect this stop before continuing."
          : waited.state === "paused" && same
          ? "The step returned to the same source line; inspect values or step again, since async and inline calls can revisit a line."
          : waited.state === "paused"
          ? "Inspect the current frame and request identifiers after async stepping; the same worker thread can run different requests. Confirm completion on the original request."
          : "The step is still running; check debug status before issuing another step.",
      } : waited)
    } else if (action === "resume") {
      const result = await tool(ide, map.resume, await input(args), 30_000)
      const status = await attempt(() => tool(ide, "get_debug_session_status", {
        session_id: object(result) ? result.sessionId : undefined,
        include_variables: false, include_source_context: false, max_stack_frames: 1,
      }))
      print({
        ...(object(result) ? result : { result }),
        observation: status.ok ? pause(status.value) : status,
        hint: status.ok && object(status.value) && status.value.state === "paused"
          ? "Execution paused again; inspect this location and its values before resuming the same request."
          : "Resume was accepted; check both backend and browser debugger status before judging the request, since another breakpoint can pause it again.",
      })
    } else if (action && map[action])
      print(
        await tool(
          ide,
          map[action],
          {
            include_variables: action === "status" ? false : undefined,
            include_source_context: action === "status" ? false : undefined,
            max_stack_frames: action === "status" ? 5 : undefined,
            ...(await input(args)),
          },
          30_000,
        ),
      )
    else if (action === "wait") {
      const seconds = args[0] && /^\d+$/.test(args[0]) ? Number(args.shift()) : timeout ? Number(timeout) : 60
      if (!Number.isFinite(seconds) || seconds < 1) throw new Error("debug wait timeout must be positive")
      const waited = await observe(
        (name, args, timeout) => tool(ide, name, args, timeout), {}, Date.now() + seconds * 1000,
        ide.id === "webstorm" && session ? () => sessionBlocked(session) : undefined,
      )
      if (!details && args.length) throw new Error("debug wait variable names require --inspect")
      const status = object(waited) && waited.state !== "paused" ? await tool(ide, "get_debug_session_status", { include_variables: false, include_source_context: false, max_stack_frames: 5 }) : undefined
      if (status !== undefined && !object(status)) throw new Error("Debugger returned an invalid session status")
      const result = object(status) && status.state === "paused" ? status : waited
      print(
        details && object(result) && result.state === "paused"
          ? await snapshot(ide, index(), args, result)
          : object(result) && object(result.blocker)
            ? { ...pause(result), blocking: result.blocker, hint: result.blocker.hint }
          : object(result) && result.state !== "paused"
            ? { ...pause(result), diagnosis: await diagnosis(ide), hint: ide.id === "webstorm" ? "Trigger the operation after setting breakpoints (reload the same app page for load requests), then wait again; no pause alone does not prove a binding failure." : "Trigger the code path after setting breakpoints: send a request, perform the UI action, or wait for the service's own background interval, then wait again; no pause alone does not prove a binding failure." }
            : pause(result),
      )
    } else if (action === "inspect") {
      const selected = args[0] && /^\d+$/.test(args[0]) ? Number(args.shift()) : index()
      print(await snapshot(ide, selected, args))
    } else if (action === "vars") {
      const raw = args.join(" ").trim()
      const result = !raw
        ? await tool(ide, "get_variables", { frame_index: index() })
        : raw.startsWith("{") || raw === "-"
          ? await tool(ide, "get_variables", await input(args))
          : await values(ide, args, index())
      print(object(result) && Array.isArray(result.variables) && result.variables.length === 0
        ? { ...result, hint: "This frame exposes no locals; inspect another stack frame or evaluate a specific expression." }
        : result)
    } else if (action === "stack") print(await tool(ide, "get_stack_trace", { max_frames: 5, ...(await input(args)) }))
    else if (action === "source")
      print(await tool(ide, "get_source_context", { lines_before: 3, lines_after: 3, ...(await input(args)) }))
    else if (action === "console")
      print(await tool(ide, "get_console_output", { lines: 20, max_chars: 4000, ...(await input(args)) }))
    else if (action === "threads") print(await tool(ide, "list_threads", await input(args)))
    else if (action === "frame") {
      const frame = Number(args.shift())
      if (!Number.isInteger(frame) || frame < 0) throw new Error("debug frame requires a non-negative index")
      print(await tool(ide, "select_stack_frame", { frame_index: frame }))
    } else if (action === "text") {
      const pointer = args.shift()
      const length = args.shift()
      if (!pointer || !length || args.length) throw new Error("debug text requires POINTER LENGTH, for example request.head.uri.path_and_query.data.bytes.ptr request.head.uri.path_and_query.data.bytes.len")
      const value = async (expression: string) => {
        const result = await tool(ide, "evaluate_expression", { expression, frame_index: index() })
        const row = object(result) && object(result.result) ? result.result : undefined
        if (!row || typeof row.value !== "string" || row.error) throw new Error(`Cannot evaluate ${expression}: ${row && typeof row.error === "string" ? row.error.trim() : "no value"}`)
        return row.value.trim()
      }
      const size = Number(/^\d+$/.test(length) ? length : await value(length))
      if (!Number.isInteger(size) || size < 0) throw new Error(`${length} is not a byte length`)
      const count = Math.min(size, 256)
      const bytes = []
      for (const item of Array.from({ length: count }, (_, i) => i)) bytes.push(Number(await value(`(*(${pointer} as *const [u8; ${count}]))[${item}]`)))
      if (!bytes.every((item) => Number.isInteger(item) && item >= 0 && item < 256)) throw new Error(`${pointer} does not point to bytes`)
      print({ text: new TextDecoder().decode(new Uint8Array(bytes)), length: size, truncated: size > count })
    } else if (action === "eval") {
      const expression = args.join(" ").trim()
      if (!expression) throw new Error("debug eval requires an expression")
      print(await tool(ide, "evaluate_expression", { expression, frame_index: index() }))
    } else if (action === "set") {
      const target = args.shift()
      const value = args.join(" ").trim()
      if (!target || !value) throw new Error("debug set requires TARGET EXPRESSION")
      print(await tool(ide, "evaluate_expression", { expression: `${target} = (${value})`, frame_index: index() }))
    } else if (action === "start") {
      const value = args.join(" ").trim()
      // A service name stands for its run configuration; the project's preflight runs first, as it does for Rust jobs.
      const name = value === "frontend" ? needFrontend().configuration : value === "browser" ? needFrontend().browser : service(value)
      if (!name) throw new Error("debug start requires a configuration name")
      if (known(value)) await preflight()
      const run = await config(ide, name)
      if (run.typeId === "FlutterRunConfigurationType") {
        // The Flutter plugin launches on the device its toolbar selector holds, not one named in the configuration.
        const variable = known(value) ? find(value).device : undefined
        const target = device || (variable ? vars()[variable] : undefined)
        if (target) await debug.flutterDevice(ide, target)
      }
      const prior = ide.id === "webstorm" && run.typeId === "JavascriptDebugType" ? (await debug.browserProcesses(ide)).map((row) => row.pid) : undefined
      const result = await launch(ide, name)
      if (ide.id === "webstorm" && run.typeId === "JavascriptDebugType") {
        const browser = await launchedBrowser(ide, { prior })
        print({ ...(object(result) ? result : { result }), browser })
      } else print(result)
    } else if (action === "run") {
      const name = args.join(" ").trim()
      if (!name) throw new Error("debug run requires a configuration name")
      print(await tool(ide, "execute_run_configuration", { name, mode: "run" }, 10_000))
    } else {
      const name = action?.replaceAll("-", "_")
      if (!name || !ide.tools.some((item) => item.name === name)) throw new Error("unknown debug command")
      print(await tool(ide, name, await input(args), 30_000))
    }
    return 0
  }
  if (group === "test") {
    const action = args.shift()
    if (action === "breakpoint") print(await smoke())
    else if (action === "browser") print(await browserSmoke())
    else throw new Error("test expects breakpoint|browser")
    return 0
  }
  throw new Error(`unknown command ${group}`)
}


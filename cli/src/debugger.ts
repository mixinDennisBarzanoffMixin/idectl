import fs from "node:fs"
import path from "node:path"
import { browsers } from "./discovery"
import { native } from "./jetbrains"
import { cfg, needFrontend } from "./config"
import { ides, root, object, command, attempt, sockets, owner, identity, probe, rpc, opened, record, content, rows, runs, field, preview, selection, stamp, quote } from "./core"
import type { Endpoint, Json } from "./core"

type Options = { chosen?: string; override?: string; session?: string; project?: string; configuration?: string }

export function evaluation(error: string) {
  if (error.includes("not a scalar type"))
    return "The native evaluator cannot compare this value directly; use supported scalar fields in conditions, then inspect the actual local to confirm the intended request."
  if (/UnsupportedFunction|extra tokens at EOF|not calling a function/.test(error))
    return "The native evaluator does not support this call or syntax; use debug vars and inspect stored fields instead of calling methods."
  return "This frame cannot resolve the expression; inspect debug vars and the selected stack frame, then use debug commands eval to check supported syntax."
}

export function debuggerClient(opts: Options) {
  const chosen = opts.chosen
  const override = opts.override
  const session = opts.session
  const project = opts.project
  async function browserProcesses(ide: Endpoint) {
    if (ide.id !== "webstorm" || !ide.pid) throw new Error("Browser discovery requires a verified WebStorm process")
    return browsers(await command(["ps", "-eo", "pid=,ppid=,args="], root, 1000), ide.pid)
  }

  async function launchedBrowser(ide: Endpoint, opts: { endpoint?: string; prior?: number[] } = {}) {
    if (process.platform !== "linux") throw new Error("IDE browser discovery is supported on Linux VMs")
    if (ide.id !== "webstorm") throw new Error("Browser attachment requires --ide webstorm; a managed service's wait result already includes preview.arguments")
    if (!ide.pid) throw new Error(`A verified WebStorm process is required; open ${needFrontend().project} --ide webstorm first`)
    const dir = project ? path.resolve(project) : opened(ide)
    const file = dir ? record(dir) : undefined
    const state: unknown = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined
    const endpoint = opts.endpoint || (opts.prior === undefined && object(state) && typeof state.endpoint === "string" ? state.endpoint : undefined)
    if (endpoint) {
      if (!opts.endpoint && (!object(state) || state.closed !== false || state.ide !== ide.id || state.bridge !== ide.pid)) throw new Error("Recorded browser belongs to a different IDE project")
      const target = new URL(endpoint)
      if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !target.port) throw new Error("Recorded browser endpoint is invalid")
      const socket = (await sockets()).find((item) => item.port === Number(target.port))
      if (!socket?.pid) throw new Error("Recorded browser is not listening")
      const exe = path.basename(fs.realpathSync(`/proc/${socket.pid}/exe`))
      if (!/^(chrome|chromium|chrome-headless-shell|headless_shell|Google Chrome(?: for Testing| Canary)?)$/i.test(exe))
        throw new Error("Recorded browser listener is not Chromium")
      const response = await fetch(new URL("/json/version", target), { signal: AbortSignal.timeout(3000) })
      if (!response.ok) throw new Error(`Browser debug endpoint returned HTTP ${response.status}`)
      const data: unknown = await response.json()
      if (!object(data) || typeof data.Browser !== "string" || typeof data.webSocketDebuggerUrl !== "string")
        throw new Error("The browser listener is not a Chromium debugging endpoint")
      const token = stamp(socket.pid)
      if (!token) throw new Error("Cannot identify the browser process")
      return { ok: true, pid: socket.pid, token, endpoint: target.origin, ...preview(target.origin) }
    }
    for (let count = 0; count < 30; count++) {
      const rows = (await browserProcesses(ide)).filter((row) => !opts.prior?.includes(row.pid))
      const live = await sockets()
      const found = rows.flatMap((row) => {
        const file = path.join(row.profile, "DevToolsActivePort")
        if (!fs.existsSync(file)) return []
        const port = Number(fs.readFileSync(file, "utf8").split("\n")[0])
        if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Browser wrote an invalid debugging port: ${file}`)
        if (!live.some((socket) => socket.pid === row.pid && socket.port === port)) return []
        return [{ pid: row.pid, endpoint: `http://127.0.0.1:${port}` }]
      })
      if (found.length > 1) throw new Error(`WebStorm has multiple debug browsers: ${JSON.stringify(found)}; select the managed browser with debug browser --service NAME, or inspect debug sessions --ide webstorm --project ${dir}`)
      if (found.length === 1) {
        const result = await fetch(`${found[0].endpoint}/json/version`, { signal: AbortSignal.timeout(3000) })
        if (!result.ok) throw new Error(`Browser debug endpoint returned HTTP ${result.status}`)
        const data: unknown = await result.json()
        if (!object(data) || typeof data.Browser !== "string" || typeof data.webSocketDebuggerUrl !== "string")
          throw new Error("The browser listener is not a Chromium debugging endpoint")
        const token = stamp(found[0].pid)
        if (!token) throw new Error("Cannot identify the browser process")
        return { ok: true, ...found[0], token, ...preview(found[0].endpoint) }
      }
      await Bun.sleep(150)
    }
    throw new Error("WebStorm has no listening debug browser; start its JavaScript debug configuration first")
  }

  async function endpoints(target?: string | number) {
    const live = await sockets()
    const map = new Map(live.filter((row) => identity(row.port, row.process)).map((row) => [row.port, row]))
    ides.forEach((ide) => {
      if (!map.has(ide.port)) map.set(ide.port, { port: ide.port })
    })
    if (override) {
      const port = Number(override)
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be 1..65535")
      if (!map.has(port)) map.set(port, { port })
    }
    const rows = await Promise.all(
      [...map.values()].filter((row) => {
        if (target === undefined) return true
        if (typeof target === "number") return row.port === target
        const known = identity(row.port, row.process)
        return known?.id === target || known?.name.toLowerCase() === target.toLowerCase()
      }).map(async (row) => {
        if (!live.some((item) => item.port === row.port)) {
          if (override && row.port === Number(override))
            throw new Error(`Debugger port ${row.port} is not listening; start the IDE and enable Debugger MCP`)
          return
        }
        const status = await owner(row)
        if (!status.verified) throw new Error(`Debugger port ${row.port}: ${status.reason}; no probe sent`)
        return probe(row.port, row.process, row.pid)
      }),
    )
    return rows.filter((row): row is Endpoint => Boolean(row)).sort((a, b) => a.port - b.port)
  }

  async function endpoint() {
    const rows = await endpoints(override ? Number(override) : chosen)
    if (override) {
      const found = rows.find((row) => row.port === Number(override))
      if (found) return found
      throw new Error(`no Debugger MCP server found on port ${override}`)
    }
    if (chosen) {
      const found = rows.find((row) => row.id === chosen || row.name.toLowerCase() === chosen.toLowerCase())
      if (found) return found
      throw new Error(`no active Debugger MCP server found for ${chosen}`)
    }
    if (project) return selection(rows, project)
    if (!rows.length) throw new Error("no JetBrains Debugger MCP server found; launch an IDE and enable the Debugger MCP Server plugin")
    throw new Error(`Select --service NAME or --ide ID; active IDEs: ${rows.map((row) => row.id).join(", ")}`)
  }

  async function tool(ide: Endpoint, name: string, input: Json = {}, timeout = 60_000) {
    const schema = ide.tools.find((item) => item.name === name)
    if (!schema) {
      const alternate = name.replaceAll("-", "_")
      if (alternate !== name && ide.tools.some((item) => item.name === alternate))
        throw new Error(`${ide.name} does not expose ${name}; raw MCP tool names use underscores: ${alternate}`)
      throw new Error(`${ide.name} does not expose ${name}; use mcp tools to list available tool names`)
    }
    const args = { ...input }
    if (!object(schema.inputSchema)) throw new Error(`${name} has an invalid input schema`)
    const props = schema.inputSchema.properties
    if (props !== undefined && !object(props)) throw new Error(`${name} has invalid input properties`)
    if (session && props?.session_id && !args.session_id) args.session_id = session
    if (props?.project_path && !args.project_path) {
      const target = project ? path.resolve(project) : opened(ide)
      if (!target) throw new Error("No IDE project selected; open a project or pass --project")
      args.project_path = target
    }
    if (name === "set_breakpoint") {
      const all = rows(content(await rpc(ide.port, "tools/call", {
        name: "list_breakpoints", arguments: { project_path: args.project_path },
      }, timeout)), "breakpoints")
      const existing = all.find((row) => row.temporary === true && row.file === args.file_path && row.line === args.line)
      if (existing || args.temporary === true) {
        const sessions = rows(content(await rpc(ide.port, "tools/call", {
          name: "list_debug_sessions", arguments: { project_path: args.project_path },
        }, timeout)), "sessions").filter((row) => row.state === "paused")
        for (const row of sessions) {
          const id = field(row, ["id", "sessionId"])
          if (!id) throw new Error("Paused debug session has no ID")
          const status = content(await rpc(ide.port, "tools/call", {
            name: "get_debug_session_status", arguments: { project_path: args.project_path, session_id: id, include_variables: false, include_source_context: false, max_stack_frames: 1 },
          }, timeout))
          if (object(status) && (
            object(status.breakpointHit) && existing && status.breakpointHit.breakpointId === existing.id ||
            object(status.currentLocation) && status.currentLocation.file === args.file_path && status.currentLocation.line === args.line
          ))
            throw new Error(`Execution is already paused at this one-shot location; inspect it, resume or step away with --ide ${ide.id}${typeof args.project_path === "string" ? ` --project ${quote(args.project_path)}` : ""} --session ${id}, then arm a fresh breakpoint before triggering a new action. Removing and recreating it while paused can stop on the same request again.`)
        }
      }
    }
    if (props?.session_id && !args.session_id && !(name === "get_source_context" && args.file_path)) {
      const result = content(
        await rpc(ide.port, "tools/call", {
          name: "list_debug_sessions",
          arguments: { project_path: args.project_path },
        }, timeout),
      )
      const all = rows(result, "sessions")
      const live = opts.configuration ? all.filter((row) => runs(row, opts.configuration!) && ["running", "paused"].includes(String(row.state))) : all
      if (opts.configuration && !live.length) throw new Error(`No active ${opts.configuration} debug session; check debug jobs before starting another launch`)
      if (live.length > 1)
        throw new Error(
          `Select --session ID: ${JSON.stringify(live.map((row) => ({ id: row.id, name: row.name, state: row.state })))}; for frontend inspection select the paused ${needFrontend().browser} session and inspect before resuming`,
        )
      if (live.length === 1) args.session_id = field(live[0], ["id", "sessionId"])
    }
    const result = content(await rpc(ide.port, "tools/call", { name, arguments: args }, timeout))
    if (name === "evaluate_expression" && object(result) && object(result.result) && typeof result.result.value === "string" && result.result.value.startsWith("ERROR:")) {
      const error = result.result.value
      return { ...result, result: { ...result.result, error, hint: evaluation(error) } }
    }
    if (["set_breakpoint", "remove_breakpoint"].includes(name)) {
      const client = await native(ide)
      await client.call("idectl_save_project", { projectPath: args.project_path }, timeout)
    }
    return result
  }

  async function filter(ide: Endpoint, configuration: string, target?: unknown) {
    const client = await native(ide)
    try {
      return content(await client.call("idectl_debug_filter", {
        configuration, projectPath: typeof target === "string" ? target : project || opened(ide),
      }, 5000))
    } finally {
      await client.close()
    }
  }

  /** Hot-reloads (or restarts) the project's running Flutter apps; the IDE re-reads files from disk first. */
  async function flutterReload(ide: Endpoint, restart: boolean) {
    const client = await native(ide)
    try {
      return content(await client.call("idectl_flutter_reload", { restart, projectPath: project || opened(ide) }, 120_000))
    } finally {
      await client.close()
    }
  }

  /** Hot-reloads a Dart VM (a server the IDE debugs) through its VM service; the debugger stays attached. */
  async function dartReload(file: string) {
    const uri = fs.existsSync(file) ? (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")).uri as unknown } catch { return undefined } })() : undefined
    if (typeof uri !== "string") return { ok: false, error: `No Dart VM service URI in ${file}; is the service running under the debugger?` }
    const socket = new WebSocket(`${uri.replace(/^http/, "ws")}ws`)
    const waiting = new Map<number, (value: Json) => void>()
    const count = { value: 0 }
    const call = (method: string, params: Json = {}) => new Promise<Json>((resolve) => {
      const id = ++count.value
      waiting.set(id, resolve)
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    })
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data))
      const done = waiting.get(message.id)
      if (done) { waiting.delete(message.id); done(message) }
    }
    try {
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error(`Cannot reach the Dart VM service at ${uri}`))
      })
      const vm = await call("getVM")
      const isolates = object(vm.result) && Array.isArray(vm.result.isolates) ? vm.result.isolates.filter(object) : []
      const reports = await Promise.all(isolates.map(async (isolate) => {
        const reply = await call("reloadSources", { isolateId: String(isolate.id) })
        const ok = object(reply.result) && reply.result.success === true
        return { isolate: String(isolate.name), ok, ...(ok ? {} : { error: reply.error ?? reply.result }) }
      }))
      return { ok: reports.length > 0 && reports.every((item) => item.ok), isolates: reports }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      socket.close()
    }
  }

  /** Points the IDE's Flutter device selector at one device; the device list loads asynchronously after the project opens. */
  async function flutterDevice(ide: Endpoint, device: string) {
    const client = await native(ide)
    try {
      const target = project || opened(ide)
      const seen: { devices: unknown } = { devices: [] }
      for (const delay of [0, 1000, 2000, 3000, 4000, 5000, 5000, 5000, 5000]) {
        if (delay) await Bun.sleep(delay)
        const result = content(await client.call("idectl_flutter_device", { device, projectPath: target }, 5000))
        if (object(result) && result.selected === true) return result
        if (object(result)) seen.devices = result.devices
      }
      throw new Error(`Flutter in ${ide.name} does not list device ${device}; connected: ${JSON.stringify(seen.devices)}`)
    } finally {
      await client.close()
    }
  }

  async function configs(ide: Endpoint, target?: string) {
    const data = await tool(ide, "list_run_configurations", { project_path: target })
    return rows(data, "configurations")
  }

  async function config(ide: Endpoint, name: string) {
    for (const delay of [0, 200, 400, 800, 1_600]) {
      if (delay) await Bun.sleep(delay)
      const rows = await configs(ide)
      const found = rows.find((row) => row.name === name)
      if (found) return found
    }
    throw new Error(`${name} is not loaded in ${ide.name}; open ${root} and let project run configurations refresh`)
  }

  async function sessions(ide: Endpoint) {
    return rows(await tool(ide, "list_debug_sessions"), "sessions")
  }

  async function launch(ide: Endpoint, name: string) {
    await config(ide, name)
    const before = await sessions(ide)
    const result = await attempt(() => tool(ide, "start_debug_session", { configuration_name: name }, 60_000))
    if (result.ok) return result.value
    if (!/timed?\s*out|timeout/i.test(result.error)) throw new Error(result.error)
    const live = (await sessions(ide)).filter(
      (row) =>
        (row.name === name || row.runConfigurationName === name) &&
        !before.some((old) => field(old, ["id", "sessionId"]) === field(row, ["id", "sessionId"])),
    )
    if (live.length === 1)
      return {
        status: "started",
        verified: true,
        message: "Start reply timed out; verified the new session without launching again",
        session: live[0],
      }
    throw new Error(`Start reply timed out; launch outcome is unknown. Inspect debug sessions before repeating ${name}`)
  }


  return { launchedBrowser, browserProcesses, endpoints, endpoint, tool, filter, flutterDevice, flutterReload, dartReload, configs, config, sessions, launch }
}

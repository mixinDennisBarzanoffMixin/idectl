import fs from "node:fs"
import path from "node:path"

export type Agent = "node" | "sidecar"
export type Mode = "intercept" | "replace"
export type Target = {
  id: string
  project: string
  configuration: string
  /** Health path and port variable: absent for a process that serves nothing, such as a Flutter app. */
  health?: string
  port?: string
  /** Routing identity in the environment; the `none` adapter has none. */
  workload: string
  container?: string
  service?: string
  agent: Agent
  mode: Mode
}
export const ideIds = ["rustrover", "webstorm", "android-studio"] as const
export type Ide = (typeof ideIds)[number]
/** Rust services run a built binary in RustRover; Node and Bun services run a WebStorm configuration and Dart and Flutter services an Android Studio one, neither with a binary. */
export type Service = Target & { ide: Ide; binary?: string; container: string; /** Env-file variable naming the device a Flutter configuration launches on. */ device?: string; /** File the service's Dart VM writes its service URI to (--write-service-info), so debug reload can hot-reload it. */ vmService?: string }
export type Frontend = Target & { browser: string; url: string; mounted: string }
export type Kubernetes = { type: "kubernetes"; namespace: string; skip: string[]; manager?: { namespace: string; release: string } }
/** A debugger-attach configuration for processes the services spawn themselves; `file` holds the inspect port the spawner reads. */
export type Attach = { project: string; configuration: string; port: string; file: string; service?: string }
export type Adapter = Kubernetes | { type: "none" }
export type Config = {
  root: string
  cli: string
  env: string
  state: string
  preflight?: string[]
  hooks: { runtime?: string[]; login?: string[] }
  adapter: Adapter
  /** A browser-hosted app to debug; omit it for projects without one (mobile, server-only). */
  frontend?: Frontend
  services: Record<string, Service>
  attach: Record<string, Attach>
  test?: {
    configuration: string
    file: string
    marker: string
    browser?: { file: string; line: string; expression: string; value: string }
  }
}

export const name = "idectl"
export const file = "idectl.json"

function find(dir: string): string {
  if (fs.existsSync(path.join(dir, file))) return dir
  const parent = path.dirname(dir)
  if (parent === dir) throw new Error(`No ${file} found in ${process.cwd()} or its parents; run ${name} inside a configured project`)
  return find(parent)
}

function text(value: unknown, key: string) {
  if (typeof value !== "string" || !value) throw new Error(`${file}: ${key} must be a nonempty string`)
  return value
}

function argv(value: unknown, key: string) {
  if (value === undefined) return
  if (!Array.isArray(value) || !value.length || !value.every((item) => typeof item === "string" && item))
    throw new Error(`${file}: ${key} must be a nonempty array of strings`)
  return value.filter((item): item is string => typeof item === "string")
}

function record(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file}: ${key} must be an object`)
  return value as Record<string, unknown>
}

function target(id: string, value: unknown, key: string, routed: boolean): Target {
  const item = record(value, key)
  // Routing fields only mean something to an environment adapter; with `none` they default.
  const agent = routed ? text(item.agent, `${key}.agent`) : String(item.agent ?? "node")
  const mode = routed ? text(item.mode, `${key}.mode`) : String(item.mode ?? "intercept")
  if (agent !== "node" && agent !== "sidecar") throw new Error(`${file}: ${key}.agent must be node or sidecar`)
  if (mode !== "intercept" && mode !== "replace") throw new Error(`${file}: ${key}.mode must be intercept or replace`)
  if (item.health !== undefined && !text(item.health, `${key}.health`).startsWith("/")) throw new Error(`${file}: ${key}.health must be a path`)
  return {
    id,
    project: text(item.project, `${key}.project`),
    configuration: text(item.configuration, `${key}.configuration`),
    health: item.health === undefined ? undefined : text(item.health, `${key}.health`),
    port: item.port === undefined ? undefined : text(item.port, `${key}.port`),
    workload: routed ? text(item.workload, `${key}.workload`) : String(item.workload ?? ""),
    container: item.container === undefined ? undefined : text(item.container, `${key}.container`),
    service: item.service === undefined ? undefined : text(item.service, `${key}.service`),
    agent,
    mode,
  }
}

function isIde(value: string): value is Ide {
  return (ideIds as readonly string[]).includes(value)
}

function adapter(value: unknown): Adapter {
  const item = record(value, "adapter")
  if (item.type === "none") return { type: "none" }
  if (item.type !== "kubernetes") throw new Error(`${file}: adapter.type must be kubernetes or none`)
  if (!Array.isArray(item.skip) || !item.skip.every((row) => typeof row === "string" && row))
    throw new Error(`${file}: adapter.skip must list environment name prefixes`)
  const manager = item.manager === undefined ? undefined : record(item.manager, "adapter.manager")
  return {
    type: "kubernetes",
    namespace: text(item.namespace, "adapter.namespace"),
    skip: item.skip.filter((row): row is string => typeof row === "string"),
    manager: manager ? { namespace: text(manager.namespace, "adapter.manager.namespace"), release: text(manager.release, "adapter.manager.release") } : undefined,
  }
}

export function load(dir: string): Config {
  const data = record(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")), file)
  const hooks = data.hooks === undefined ? {} : record(data.hooks, "hooks")
  const front = data.frontend === undefined ? undefined : record(data.frontend, "frontend")
  const adapterValue = adapter(data.adapter)
  const routed = adapterValue.type !== "none"
  const services = record(data.services, "services")
  const attach = data.attach === undefined ? {} : record(data.attach, "attach")
  const test = data.test === undefined ? undefined : record(data.test, "test")
  if (!Object.keys(services).length) throw new Error(`${file}: services must define at least one service`)
  if (services.frontend) throw new Error(`${file}: frontend is reserved; configure it under frontend`)
  return {
    root: dir,
    cli: text(data.cli, "cli"),
    env: path.join(dir, text(data.env, "env")),
    state: path.join(dir, text(data.state, "state")),
    preflight: argv(data.preflight, "preflight"),
    hooks: { runtime: argv(hooks.runtime, "hooks.runtime"), login: argv(hooks.login, "hooks.login") },
    adapter: adapterValue,
    frontend: front
      ? {
          ...target("frontend", front, "frontend", routed),
          browser: text(front.browser, "frontend.browser"),
          url: text(front.url, "frontend.url"),
          mounted: text(front.mounted, "frontend.mounted"),
        }
      : undefined,
    services: Object.fromEntries(Object.entries(services).map(([id, value]) => {
      const item = record(value, `services.${id}`)
      const ide = text(item.ide, `services.${id}.ide`)
      if (!isIde(ide)) throw new Error(`${file}: services.${id}.ide must be ${ideIds.join(", ")}`)
      if (ide !== "rustrover" && item.binary !== undefined) throw new Error(`${file}: services.${id}.binary applies to rustrover services only`)
      return [id, {
        ...target(id, item, `services.${id}`, routed),
        ide,
        binary: ide === "rustrover" ? text(item.binary, `services.${id}.binary`) : undefined,
        container: routed ? text(item.container, `services.${id}.container`) : String(item.container ?? ""),
        device: item.device === undefined ? undefined : text(item.device, `services.${id}.device`),
        vmService: item.vmService === undefined ? undefined : text(item.vmService, `services.${id}.vmService`),
      }]
    })),
    attach: Object.fromEntries(Object.entries(attach).map(([id, value]) => {
      const item = record(value, `attach.${id}`)
      if (!/^\d+$/.test(text(item.port, `attach.${id}.port`))) throw new Error(`${file}: attach.${id}.port must be a number string`)
      return [id, {
        project: text(item.project, `attach.${id}.project`),
        configuration: text(item.configuration, `attach.${id}.configuration`),
        port: text(item.port, `attach.${id}.port`),
        file: text(item.file, `attach.${id}.file`),
        service: item.service === undefined ? undefined : text(item.service, `attach.${id}.service`),
      }]
    })),
    test: test ? {
      configuration: text(test.configuration, "test.configuration"),
      file: text(test.file, "test.file"),
      marker: text(test.marker, "test.marker"),
      browser: test.browser === undefined ? undefined : (() => {
        const item = record(test.browser, "test.browser")
        return {
          file: text(item.file, "test.browser.file"),
          line: text(item.line, "test.browser.line"),
          expression: text(item.expression, "test.browser.expression"),
          value: text(item.value, "test.browser.value"),
        }
      })(),
    } : undefined,
  }
}

export const cfg = load(find(process.cwd()))

/** The browser-hosted app; commands that need one fail here, with a message that names the missing configuration. */
export function needFrontend(): Frontend {
  if (!cfg.frontend) throw new Error(`This command needs a browser-hosted app: add "frontend" to ${file}`)
  return cfg.frontend
}

export function service(id: string) {
  const found = cfg.services[id] || Object.values(cfg.services).find((item) => item.configuration === id)
  if (!found) throw new Error(`Unknown service ${id}; expected ${Object.keys(cfg.services).join("|")}`)
  return found
}

export function known(id: string) {
  return Boolean(cfg.services[id] || Object.values(cfg.services).some((item) => item.configuration === id))
}

export function shm(kind: string) {
  return `/dev/shm/${name}-${kind}`
}

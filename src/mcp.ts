import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { createInterface, type Interface } from 'node:readline'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LoggerLike {
  info?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
}

function log(logger: LoggerLike | undefined, level: LogLevel, ...args: unknown[]) {
  if (logger) {
    const fn = logger[level]
    if (typeof fn === 'function') {
      // 保持 this 绑定（pino logger 需要）
      fn.apply(logger, args as any)
      return
    }
  }
  if (level === 'debug') {
    console.log(...args)
    return
  }
  console[level](...args)
}

interface JsonRpcError {
  code?: number
  message?: string
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: any
  error?: JsonRpcError
}

interface MCPRawConfig {
  name?: string
  description?: string
  type?: string
  command?: string
  args?: unknown
  env?: unknown
  enabled?: boolean
}

interface MCPServerConfig {
  name: string
  description: string
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  serviceDir: string
}

interface MCPListedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface MCPToolBinding {
  fullName: string
  rawName: string
  serverName: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface OpenAIFunctionTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePathForSpawn(pathText: string): string {
  return pathText.replace(/\\/g, '/')
}

function toStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v
    else if (v != null) out[k] = String(v)
  }
  return out
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

class MCPStdioConnection {
  private process: ChildProcessWithoutNullStreams | null = null
  private outRl: Interface | null = null
  private errRl: Interface | null = null
  private requestId = 0
  private pending = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void
      reject: (reason?: unknown) => void
      timer: NodeJS.Timeout
    }
  >()
  private tools: MCPListedTool[] = []

  public constructor(
    private readonly config: MCPServerConfig,
    private readonly logger?: LoggerLike
  ) {}

  public async start(): Promise<void> {
    if (this.process) return

    this.process = spawn(this.config.command, this.config.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...this.config.env },
      windowsHide: true,
      stdio: 'pipe',
    })

    this.process.on('error', (err) => {
      log(this.logger, 'error', { err, server: this.config.name }, 'MCP 子进程启动失败')
      this.rejectAllPending(new Error(`MCP process error: ${String(err)}`))
    })

    this.process.on('exit', (code, signal) => {
      log(
        this.logger,
        'warn',
        { server: this.config.name, code, signal },
        'MCP 子进程退出'
      )
      this.rejectAllPending(new Error(`MCP process exited: code=${code}, signal=${signal}`))
    })

    this.outRl = createInterface({ input: this.process.stdout })
    this.outRl.on('line', (line) => this.handleStdoutLine(line))

    this.errRl = createInterface({ input: this.process.stderr })
    this.errRl.on('line', (line) => {
      const text = String(line ?? '').trim()
      if (!text) return
      log(this.logger, 'debug', { server: this.config.name, line: text }, 'MCP stderr')
    })

    await this.initialize()
    await this.refreshTools()

    log(
      this.logger,
      'info',
      { server: this.config.name, toolCount: this.tools.length },
      'MCP stdio 服务已连接'
    )
  }

  public async stop(): Promise<void> {
    this.rejectAllPending(new Error('MCP connection stopped'))

    if (this.outRl) {
      this.outRl.close()
      this.outRl = null
    }
    if (this.errRl) {
      this.errRl.close()
      this.errRl = null
    }

    if (this.process) {
      this.process.kill()
      this.process = null
    }

    this.tools = []
  }

  public getTools(): MCPListedTool[] {
    return [...this.tools]
  }

  public async callTool(rawToolName: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.sendRequest('tools/call', {
      name: rawToolName,
      arguments: args,
    })

    if (response.error) {
      throw new Error(response.error.message ?? `tool call failed: ${rawToolName}`)
    }

    const content = response.result?.content
    if (Array.isArray(content)) {
      const textParts = content
        .filter((item) => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
        .map((item) => String(item.text))
      if (textParts.length > 0) return textParts.join('\n')
      return JSON.stringify(content, null, 2)
    }

    if (typeof content === 'string') return content
    if (typeof response.result === 'string') return response.result
    return JSON.stringify(response.result ?? {}, null, 2)
  }

  private async initialize(): Promise<void> {
    const initRes = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'graywill-discord-bot', version: '0.1.0' },
    })

    if (initRes.error) {
      throw new Error(initRes.error.message ?? 'MCP initialize failed')
    }

    // 通知（大部分服务会忽略 id，兼容实现）
    await this.sendNotification('notifications/initialized', {})
  }

  private async refreshTools(): Promise<void> {
    const response = await this.sendRequest('tools/list', {})
    if (response.error) {
      throw new Error(response.error.message ?? 'MCP tools/list failed')
    }

    const toolsRaw: unknown[] = Array.isArray(response.result?.tools) ? response.result.tools : []
    this.tools = toolsRaw
      .filter(
        (t: unknown): t is Record<string, unknown> => isRecord(t) && typeof t.name === 'string'
      )
      .map((tool: Record<string, unknown>) => {
        const inputSchema = tool.inputSchema
        const inputSchemaSnake = (tool as { input_schema?: unknown }).input_schema
        const schema =
          (isRecord(inputSchema) && inputSchema) ||
          (isRecord(inputSchemaSnake) && inputSchemaSnake) ||
          { type: 'object', properties: {} }

        return {
          name: String(tool.name),
          description: typeof tool.description === 'string' ? tool.description : '',
          inputSchema: schema,
        }
      })
  }

  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.process?.stdin) return

    const payload: Record<string, unknown> = {
      jsonrpc: '2.0',
      method,
    }
    if (params) payload.params = params

    const line = `${JSON.stringify(payload)}\n`
    this.process.stdin.write(line)
  }

  private async sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<JsonRpcResponse> {
    if (!this.process?.stdin) {
      throw new Error(`MCP process not ready: ${this.config.name}`)
    }

    const id = ++this.requestId
    const payload: Record<string, unknown> = {
      jsonrpc: '2.0',
      id,
      method,
    }
    if (params) payload.params = params

    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timeout: ${method}`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
    })

    this.process.stdin.write(`${JSON.stringify(payload)}\n`)
    return await promise
  }

  private handleStdoutLine(line: string) {
    const text = String(line ?? '').trim()
    if (!text) return

    let parsed: JsonRpcResponse
    try {
      parsed = JSON.parse(text) as JsonRpcResponse
    } catch {
      return
    }

    if (typeof parsed.id === 'number') {
      const pending = this.pending.get(parsed.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(parsed.id)
        pending.resolve(parsed)
      }
    }
  }

  private rejectAllPending(error: Error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

export interface MCPManagerOptions {
  baseDir?: string
  logger?: LoggerLike
}

export class MCPManager {
  private readonly baseDir: string
  private readonly logger?: LoggerLike
  private readonly serverConfigs: MCPServerConfig[] = []
  private readonly connections = new Map<string, MCPStdioConnection>()
  private readonly tools = new Map<string, MCPToolBinding>()
  private initialized = false

  public constructor(options: MCPManagerOptions = {}) {
    this.baseDir = options.baseDir
      ? (isAbsolute(options.baseDir) ? options.baseDir : join(process.cwd(), options.baseDir))
      : join(process.cwd(), 'mcp')
    this.logger = options.logger
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return
    this.serverConfigs.push(...this.loadServerConfigs())

    for (const cfg of this.serverConfigs) {
      const conn = new MCPStdioConnection(cfg, this.logger)
      try {
        await conn.start()
      } catch (err) {
        log(this.logger, 'error', { err, server: cfg.name }, 'MCP 服务启动失败')
        continue
      }

      this.connections.set(cfg.name, conn)

      for (const tool of conn.getTools()) {
        const fullName = `${cfg.name}_${tool.name}`
        this.tools.set(fullName, {
          fullName,
          rawName: tool.name,
          serverName: cfg.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })
      }
    }

    this.initialized = true
    log(
      this.logger,
      'info',
      {
        serverCount: this.connections.size,
        toolCount: this.tools.size,
        baseDir: this.baseDir,
      },
      'MCP 初始化完成'
    )
  }

  public async dispose(): Promise<void> {
    for (const [, conn] of this.connections) {
      await conn.stop()
    }
    this.connections.clear()
    this.tools.clear()
    this.serverConfigs.length = 0
    this.initialized = false
  }

  public getOpenAITools(): OpenAIFunctionTool[] {
    const defs: OpenAIFunctionTool[] = []
    for (const [, tool] of this.tools) {
      defs.push({
        type: 'function',
        function: {
          name: tool.fullName,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })
    }
    return defs
  }

  public hasTool(toolName: string): boolean {
    return this.tools.has(toolName)
  }

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(toolName)
    if (!tool) {
      throw new Error(`工具不存在: ${toolName}`)
    }

    const conn = this.connections.get(tool.serverName)
    if (!conn) {
      throw new Error(`工具所属 MCP 服务未连接: ${tool.serverName}`)
    }

    return await conn.callTool(tool.rawName, args)
  }

  private loadServerConfigs(): MCPServerConfig[] {
    if (!existsSync(this.baseDir)) {
      log(this.logger, 'warn', { baseDir: this.baseDir }, 'MCP 目录不存在，跳过加载')
      return []
    }

    const dirents = readdirSync(this.baseDir, { withFileTypes: true })
    const out: MCPServerConfig[] = []

    for (const ent of dirents) {
      if (!ent.isDirectory()) continue
      if (ent.name.startsWith('.') || ent.name.startsWith('_')) continue

      const serviceDir = join(this.baseDir, ent.name)
      const configPath = join(serviceDir, 'config.json')
      if (!existsSync(configPath)) continue

      let raw: MCPRawConfig
      try {
        raw = JSON.parse(readFileSync(configPath, 'utf-8')) as MCPRawConfig
      } catch (err) {
        log(this.logger, 'warn', { err, configPath }, '读取 MCP config 失败，已跳过')
        continue
      }

      if (raw.enabled === false) continue
      const type = String(raw.type ?? 'stdio').trim()
      if (type !== 'stdio') {
        log(this.logger, 'warn', { service: ent.name, type }, '仅支持 stdio MCP，已跳过')
        continue
      }

      const command = String(raw.command ?? 'python').trim() || 'python'
      const args = this.resolveArgs(raw.args, serviceDir)
      const env = toStringMap(raw.env)

      out.push({
        name: String(raw.name ?? ent.name).trim() || ent.name,
        description: String(raw.description ?? '').trim(),
        type: 'stdio',
        command,
        args,
        env,
        serviceDir,
      })
    }

    return out
  }

  private resolveArgs(rawArgs: unknown, serviceDir: string): string[] {
    const argsInput = Array.isArray(rawArgs) ? rawArgs.map((x) => String(x)) : []
    const serverPyAbs = join(serviceDir, 'server.py')
    const serverPyRel = normalizePathForSpawn(relative(process.cwd(), serverPyAbs))

    if (argsInput.length === 0) {
      return existsSync(serverPyAbs) ? [serverPyRel] : []
    }

    const mapped = argsInput.map((arg) => this.resolveSingleArg(arg, serviceDir, serverPyRel))
    return mapped
  }

  private resolveSingleArg(arg: string, serviceDir: string, fallbackServerRel: string): string {
    const raw = String(arg ?? '')
    if (!raw) return raw
    if (raw.startsWith('-')) return raw

    const normalized = normalizePathForSpawn(raw)
    const candidates: string[] = []

    // 兼容从参考项目复制来的 mcp_servers/* 路径
    if (normalized.startsWith('mcp_servers/')) {
      candidates.push(normalized.replace(/^mcp_servers\//, 'mcp/'))
    }

    candidates.push(normalized)

    const absFromService = join(serviceDir, normalized)
    candidates.push(normalizePathForSpawn(relative(process.cwd(), absFromService)))

    const basename = normalized.split('/').pop() ?? normalized
    if (basename) {
      const absByBasename = join(serviceDir, basename)
      candidates.push(normalizePathForSpawn(relative(process.cwd(), absByBasename)))
    }

    if (normalized.endsWith('.py')) {
      candidates.push(fallbackServerRel)
    }

    for (const candidate of dedupe(candidates)) {
      if (this.existsAsPath(candidate)) return candidate
    }

    return raw
  }

  private existsAsPath(pathText: string): boolean {
    if (!pathText) return false
    if (isAbsolute(pathText)) return existsSync(pathText)
    return existsSync(join(process.cwd(), pathText))
  }
}
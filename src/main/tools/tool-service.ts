import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { ProviderToolDefinition, ToolApproval } from '../../shared/contracts'
import type { McpService } from '../mcp/mcp-service'

export const builtInToolIds = ['read_file', 'list_files', 'write_file', 'run_command', 'fetch_url'] as const

export interface ToolContext {
  workspacePath: string
  signal?: AbortSignal
}

export interface ApprovalRequirement {
  risk: ToolApproval['risk']
  summary: string
}

interface ToolSpec {
  definition: ProviderToolDefinition
  schema: z.ZodType<Record<string, unknown>>
  approval?: (args: Record<string, unknown>) => ApprovalRequirement
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>
}

export class ToolService {
  private readonly specs = new Map<string, ToolSpec>()

  constructor(private readonly mcp?: McpService) {
    this.registerBuiltIns()
  }

  definitions(toolIds: string[]): ProviderToolDefinition[] {
    const builtIns = toolIds.map((id) => this.specs.get(id)?.definition).filter((value): value is ProviderToolDefinition => Boolean(value))
    return [...builtIns, ...(this.mcp?.definitions(toolIds) ?? [])]
  }

  isAuthorized(toolIds: string[], toolName: string): boolean {
    if (toolIds.includes(toolName)) return true
    const logical = this.mcp?.resolveToolId(toolName)
    return logical ? toolIds.includes(logical) : false
  }

  approval(toolName: string, args: Record<string, unknown>): ApprovalRequirement | undefined {
    const mcpTool = this.mcp?.toolSummary(toolName)
    if (mcpTool) return mcpTool.tool.readOnly ? undefined : { risk: 'write', summary: `调用 MCP 工具 ${mcpTool.server.name} / ${mcpTool.tool.name}` }
    const spec = this.requireSpec(toolName)
    const parsed = spec.schema.parse(args)
    return spec.approval?.(parsed)
  }

  async execute(toolName: string, args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (this.mcp?.toolSummary(toolName)) return this.mcp.call(toolName, args, context.signal)
    const spec = this.requireSpec(toolName)
    return spec.execute(spec.schema.parse(args), context)
  }

  fingerprint(taskId: string, toolName: string, args: Record<string, unknown>): string {
    return createHash('sha256').update(`${taskId}:${toolName}:${stableJson(args)}`).digest('hex')
  }

  private requireSpec(toolName: string): ToolSpec {
    const spec = this.specs.get(toolName)
    if (!spec) throw new Error(`工具 ${toolName} 未授权或不存在`)
    return spec
  }

  private registerBuiltIns(): void {
    const pathSchema = z.object({ path: z.string().min(1) })
    this.specs.set('read_file', {
      definition: {
        name: 'read_file',
        description: '读取任务工作目录内的 UTF-8 文本文件。',
        inputSchema: objectSchema({ path: { type: 'string', description: '相对工作目录的文件路径' } }, ['path'])
      },
      schema: pathSchema,
      execute: async (args, context) => {
        const path = await safeWorkspacePath(context.workspacePath, String(args.path), false)
        const stat = await fs.stat(path)
        if (!stat.isFile()) throw new Error('目标不是文件')
        if (stat.size > 1_000_000) throw new Error('文件超过 1 MB 读取限制')
        return fs.readFile(path, 'utf8')
      }
    })
    this.specs.set('list_files', {
      definition: {
        name: 'list_files',
        description: '列出任务工作目录内某个目录的直接子项。',
        inputSchema: objectSchema({ path: { type: 'string', description: '相对工作目录的目录路径，根目录使用 .' } }, ['path'])
      },
      schema: pathSchema,
      execute: async (args, context) => {
        const path = await safeWorkspacePath(context.workspacePath, String(args.path), false)
        const entries = await fs.readdir(path, { withFileTypes: true })
        return entries.slice(0, 500).map((entry) => `${entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file'}\t${entry.name}`).join('\n')
      }
    })
    this.specs.set('write_file', {
      definition: {
        name: 'write_file',
        description: '在任务工作目录内创建或覆盖 UTF-8 文本文件。',
        inputSchema: objectSchema({
          path: { type: 'string', description: '相对工作目录的文件路径' },
          content: { type: 'string', description: '要写入的完整文本内容' }
        }, ['path', 'content'])
      },
      schema: z.object({ path: z.string().min(1), content: z.string().max(2_000_000) }),
      approval: (args) => ({ risk: 'write', summary: `写入文件 ${String(args.path)}` }),
      execute: async (args, context) => {
        const path = await safeWorkspacePath(context.workspacePath, String(args.path), true)
        await fs.writeFile(path, String(args.content), 'utf8')
        return `已写入 ${Buffer.byteLength(String(args.content), 'utf8')} bytes: ${String(args.path)}`
      }
    })
    this.specs.set('run_command', {
      definition: {
        name: 'run_command',
        description: '在任务工作目录中运行一条终端命令。每条命令都需要用户批准。',
        inputSchema: objectSchema({
          command: { type: 'string', description: '完整 shell 命令' },
          cwd: { type: 'string', description: '相对工作目录的执行目录，默认 .' },
          timeoutMs: { type: 'number', description: '超时毫秒数，最大 120000' }
        }, ['command'])
      },
      schema: z.object({ command: z.string().min(1).max(20_000), cwd: z.string().default('.'), timeoutMs: z.number().int().min(1000).max(120_000).default(60_000) }),
      approval: (args) => ({ risk: 'terminal', summary: `在 ${String(args.cwd || '.')} 运行：${String(args.command)}` }),
      execute: async (args, context) => {
        const cwd = await safeWorkspacePath(context.workspacePath, String(args.cwd || '.'), false)
        return runCommand(String(args.command), cwd, Number(args.timeoutMs), context.signal)
      }
    })
    this.specs.set('fetch_url', {
      definition: {
        name: 'fetch_url',
        description: '获取公开 HTTP(S) URL 并提取可读正文，不允许访问本机或私有网络。',
        inputSchema: objectSchema({ url: { type: 'string', description: '公开网页 URL' } }, ['url'])
      },
      schema: z.object({ url: z.string().url() }),
      execute: async (args, context) => fetchPublicUrl(String(args.url), context.signal)
    })
  }
}

export async function safeWorkspacePath(workspacePath: string, requestedPath: string, allowMissing: boolean): Promise<string> {
  if (!workspacePath) throw new Error('任务没有配置工作目录')
  const root = await fs.realpath(workspacePath)
  const candidate = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(root, requestedPath)
  let checked: string
  try {
    checked = await fs.realpath(candidate)
  } catch (error) {
    if (!allowMissing || !isMissing(error)) throw error
    const parent = await fs.realpath(dirname(candidate))
    assertContained(root, parent)
    checked = candidate
  }
  assertContained(root, checked)
  return checked
}

function assertContained(root: string, candidate: string): void {
  const relation = relative(root, candidate)
  if (relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))) return
  throw new Error('路径超出任务工作目录')
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties, required }
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))
}

async function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/bin/zsh', ['-lc', command], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    const append = (chunk: Buffer): void => { output = (output + chunk.toString('utf8')).slice(-100_000) }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolvePromise(output || '(命令没有输出)')
    }
    const abort = (): void => { child.kill('SIGTERM'); finish(new Error('命令已取消')) }
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error(`命令超过 ${timeoutMs} ms 已取消`)) }, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => finish(error))
    child.on('close', (code, signalName) => finish(code === 0 ? undefined : new Error(`命令退出码 ${code ?? signalName}: ${output.slice(-4000)}`)))
  })
}

async function fetchPublicUrl(rawUrl: string, signal?: AbortSignal): Promise<string> {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许 HTTP(S) URL')
  const addresses = await dns.lookup(url.hostname, { all: true })
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('不允许访问本机或私有网络地址')
  const timeout = AbortSignal.timeout(20_000)
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'follow' })
  if (!response.ok) throw new Error(`网页请求失败：HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > 2_000_000) throw new Error('网页超过 2 MB 获取限制')
  const text = (await response.text()).slice(0, 2_000_000)
  if (!response.headers.get('content-type')?.includes('html')) return text
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function isPrivateAddress(address: string): boolean {
  const kind = isIP(address)
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (kind === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
  }
  return true
}

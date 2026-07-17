import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createHash } from 'node:crypto'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpProbeResult, McpServerDefinition, McpToolSummary, ProviderToolDefinition } from '../../shared/contracts'
import { BossyDatabase } from '../database'

interface ConnectedServer {
  client: Client
  transport: Transport
}

export class McpService {
  private readonly connections = new Map<string, ConnectedServer>()

  constructor(private readonly database: BossyDatabase) {}

  async probe(serverId: string): Promise<McpProbeResult> {
    const server = this.database.getMcpServer(serverId)
    if (!server) throw new Error('MCP 服务不存在')
    try {
      await this.close(serverId)
      const client = await this.connect(server)
      const listed = await client.listTools(undefined, { timeout: 15_000 })
      const tools = listed.tools.map((tool): McpToolSummary => ({
        name: tool.name,
        description: tool.description ?? tool.title ?? tool.name,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        readOnly: tool.annotations?.readOnlyHint === true
      }))
      const result: McpProbeResult = { serverId, ok: true, tools, message: `连接成功，发现 ${tools.length} 个工具` }
      this.database.updateMcpProbe(serverId, result)
      return result
    } catch (error) {
      const result: McpProbeResult = { serverId, ok: false, tools: server.tools, message: safeMessage(error) }
      this.database.updateMcpProbe(serverId, result)
      return result
    }
  }

  definitions(toolIds: string[]): ProviderToolDefinition[] {
    const servers = new Map(this.database.snapshot().mcpServers.map((server) => [server.id, server]))
    return toolIds.flatMap((toolId) => {
      const parsed = parseMcpToolId(toolId)
      if (!parsed) return []
      const tool = servers.get(parsed.serverId)?.tools.find((item) => item.name === parsed.toolName)
      if (!tool) return []
      return [{ name: providerMcpToolName(toolId), description: `${tool.description}（MCP: ${servers.get(parsed.serverId)?.name}）`, inputSchema: tool.inputSchema }]
    })
  }

  toolSummary(toolId: string): { server: McpServerDefinition; tool: McpToolSummary } | undefined {
    const logicalId = this.resolveToolId(toolId)
    const parsed = logicalId ? parseMcpToolId(logicalId) : undefined
    if (!parsed) return undefined
    const server = this.database.getMcpServer(parsed.serverId)
    const tool = server?.tools.find((item) => item.name === parsed.toolName)
    return server && tool ? { server, tool } : undefined
  }

  async call(toolId: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const logicalId = this.resolveToolId(toolId)
    const parsed = logicalId ? parseMcpToolId(logicalId) : undefined
    if (!parsed) throw new Error(`无效 MCP 工具 ID: ${toolId}`)
    const server = this.database.getMcpServer(parsed.serverId)
    if (!server) throw new Error('MCP 服务已被删除')
    const client = this.connections.get(server.id)?.client ?? await this.connect(server)
    const result = await client.callTool({ name: parsed.toolName, arguments: args }, undefined, { signal, timeout: 120_000 })
    if (result.isError) throw new Error(formatMcpContent(result.content) || 'MCP 工具执行失败')
    const structured = result.structuredContent ? `\n${JSON.stringify(result.structuredContent)}` : ''
    return `${formatMcpContent(result.content)}${structured}`.trim() || '(MCP 工具没有返回文本内容)'
  }

  resolveToolId(value: string): string | undefined {
    if (parseMcpToolId(value)) return value
    for (const server of this.database.snapshot().mcpServers) {
      for (const tool of server.tools) {
        const logical = mcpToolId(server.id, tool.name)
        if (providerMcpToolName(logical) === value) return logical
      }
    }
    return undefined
  }

  async close(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId)
    if (!connection) return
    this.connections.delete(serverId)
    await connection.client.close().catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.close(id)))
  }

  private async connect(server: McpServerDefinition): Promise<Client> {
    const existing = this.connections.get(server.id)
    if (existing) return existing.client
    const client = new Client({ name: 'Bossy', version: '0.1.0' }, { capabilities: {} })
    let transport: Transport
    if (server.transport === 'stdio') {
      if (!server.command) throw new Error('stdio MCP 缺少启动命令')
      transport = new StdioClientTransport({ command: server.command, args: server.args, stderr: 'pipe' })
    } else {
      if (!server.url) throw new Error('HTTP MCP 缺少 URL')
      const token = this.database.getMcpSecret(server.id)
      transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      })
    }
    await client.connect(transport, { timeout: 15_000 })
    this.connections.set(server.id, { client, transport })
    return client
  }
}

export function mcpToolId(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`
}

export function parseMcpToolId(value: string): { serverId: string; toolName: string } | undefined {
  if (!value.startsWith('mcp:')) return undefined
  const separator = value.indexOf(':', 4)
  if (separator < 0) return undefined
  return { serverId: value.slice(4, separator), toolName: value.slice(separator + 1) }
}

function providerMcpToolName(logicalId: string): string {
  return `mcp_${createHash('sha256').update(logicalId).digest('hex').slice(0, 24)}`
}

function formatMcpContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((item) => {
    const block = item as Record<string, unknown>
    if (block.type === 'text') return String(block.text ?? '')
    if (block.type === 'resource') return JSON.stringify(block.resource)
    if (block.type === 'image') return `[图片 ${String(block.mimeType ?? '')}]`
    if (block.type === 'audio') return `[音频 ${String(block.mimeType ?? '')}]`
    return JSON.stringify(block)
  }).join('\n')
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 400) : 'MCP 连接失败'
}

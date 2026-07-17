import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AppSnapshot, McpProbeResult, McpServerDefinition } from '../../shared/contracts'
import type { BossyDatabase } from '../database'
import { McpService, mcpToolId } from './mcp-service'

describe('McpService', () => {
  it('discovers and calls tools over stdio', async () => {
    const server: McpServerDefinition = {
      id: 'test-server',
      name: 'Test MCP',
      transport: 'stdio',
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))],
      status: 'unconfigured',
      hasSecret: false,
      tools: [],
      updatedAt: new Date().toISOString()
    }
    const database = fakeDatabase(server)
    const service = new McpService(database)
    try {
      const probe = await service.probe(server.id)
      expect(probe.ok).toBe(true)
      expect(probe.tools[0]).toMatchObject({ name: 'echo', readOnly: true })
      const result = await service.call(mcpToolId(server.id, 'echo'), { text: 'Bossy' })
      expect(result).toBe('echo:Bossy')
    } finally {
      await service.closeAll()
    }
  })
})

function fakeDatabase(initial: McpServerDefinition): BossyDatabase {
  let server = initial
  return {
    getMcpServer: (id: string) => id === server.id ? server : undefined,
    getMcpSecret: () => undefined,
    updateMcpProbe: (_id: string, probe: McpProbeResult) => { server = { ...server, status: probe.ok ? 'ready' : 'error', tools: probe.tools } },
    snapshot: () => ({ mcpServers: [server] } as AppSnapshot)
  } as unknown as BossyDatabase
}


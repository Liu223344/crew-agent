import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'

const server = new McpServer({ name: 'bossy-test-server', version: '1.0.0' })

server.registerTool('echo', {
  description: 'Echo text for Bossy integration tests',
  inputSchema: { text: z.string() },
  annotations: { readOnlyHint: true }
}, async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }))

await server.connect(new StdioServerTransport())


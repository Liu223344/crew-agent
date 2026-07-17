import { describe, expect, it, vi } from 'vitest'
import type { ProviderConnection } from '../../shared/contracts'
import { createProviderAdapter } from './adapters'

describe('provider adapters', () => {
  it('discovers models and parses OpenAI Responses streaming output', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/models')) return json({ data: [{ id: 'gpt-z' }, { id: 'gpt-a' }] })
      expect(url).toBe('https://api.openai.com/v1/responses')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.model).toBe('gpt-a')
      return sse([
        { type: 'response.output_text.delta', delta: 'Hello ' },
        { type: 'response.output_text.delta', delta: 'Bossy' },
        {
          type: 'response.completed',
          response: {
            model: 'gpt-a',
            status: 'completed',
            usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
            output: [{ type: 'function_call', call_id: 'call-1', name: 'write_file', arguments: '{"path":"brief.md"}' }]
          }
        }
      ])
    }) as typeof fetch
    const adapter = createProviderAdapter(connection('openai', 'openai'), 'secret', fetcher)
    expect(await adapter.discoverModels()).toEqual(['gpt-a', 'gpt-z'])
    const deltas: string[] = []
    const result = await adapter.generate(
      { model: 'gpt-a', messages: [{ role: 'user', content: 'Build it' }] },
      { onTextDelta: (delta) => deltas.push(delta) }
    )
    expect(deltas).toEqual(['Hello ', 'Bossy'])
    expect(result.text).toBe('Hello Bossy')
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7, totalTokens: 19 })
    expect(result.toolCalls[0]).toMatchObject({ name: 'write_file', arguments: { path: 'brief.md' } })
  })

  it('parses Anthropic Messages streaming output and tool arguments', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) return json({ data: [{ id: 'claude-one' }] })
      return sse([
        { type: 'message_start', message: { model: 'claude-one', usage: { input_tokens: 9 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Draft' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"notes.md"}' } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }
      ])
    }) as typeof fetch
    const adapter = createProviderAdapter(connection('anthropic', 'anthropic', 'https://api.anthropic.com'), 'secret', fetcher)
    expect(await adapter.discoverModels()).toEqual(['claude-one'])
    const result = await adapter.generate({ model: 'claude-one', messages: [{ role: 'system', content: 'Be exact' }, { role: 'user', content: 'Draft' }] })
    expect(result.text).toBe('Draft')
    expect(result.usage).toEqual({ inputTokens: 9, outputTokens: 5, totalTokens: 14 })
    expect(result.toolCalls[0]).toMatchObject({ id: 'tool-1', name: 'read_file', arguments: { path: 'notes.md' } })
  })

  it.each([
    ['kimi', 'https://api.moonshot.cn/v1'],
    ['deepseek', 'https://api.deepseek.com']
  ])('supports %s through the OpenAI-compatible contract', async (id, baseUrl) => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/models')) return json({ data: [{ id: `${id}-model` }] })
      return sse([
        { model: `${id}-model`, choices: [{ delta: { content: '完成' }, finish_reason: null }] },
        { model: `${id}-model`, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } }
      ])
    }) as typeof fetch
    const adapter = createProviderAdapter(connection(id, 'openai-compatible', baseUrl), 'secret', fetcher)
    expect(await adapter.discoverModels()).toEqual([`${id}-model`])
    const result = await adapter.generate({ model: `${id}-model`, messages: [{ role: 'user', content: '执行' }] })
    expect(result.text).toBe('完成')
    expect(result.finishReason).toBe('stop')
    expect(result.usage.totalTokens).toBe(15)
  })
})

function connection(id: string, kind: ProviderConnection['kind'], baseUrl = 'https://api.openai.com/v1'): ProviderConnection {
  return {
    id,
    name: id,
    kind,
    baseUrl,
    status: 'ready',
    hasSecret: true,
    models: [],
    capabilities: { streaming: true, toolCalling: true, structuredOutput: kind === 'openai', vision: true },
    updatedAt: new Date().toISOString()
  }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function sse(events: Array<Record<string, unknown>>): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}


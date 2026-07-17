import type {
  ProviderConnection,
  ProviderGenerateRequest,
  ProviderToolCall,
  ProviderUsage
} from '../../shared/contracts'
import {
  anthropicUrl,
  assertOk,
  emptyUsage,
  joinUrl,
  readSse,
  type FetchLike,
  type GenerateOptions,
  type ProviderAdapter,
  type StreamAccumulator
} from './provider-adapter'

export function createProviderAdapter(connection: ProviderConnection, apiKey: string, fetcher: FetchLike = fetch): ProviderAdapter {
  if (connection.kind === 'openai') return new OpenAiResponsesAdapter(connection, apiKey, fetcher)
  if (connection.kind === 'anthropic') return new AnthropicMessagesAdapter(connection, apiKey, fetcher)
  return new OpenAiCompatibleAdapter(connection, apiKey, fetcher)
}

abstract class BaseAdapter implements ProviderAdapter {
  readonly capabilities

  constructor(
    protected readonly connection: ProviderConnection,
    protected readonly apiKey: string,
    protected readonly fetcher: FetchLike
  ) {
    this.capabilities = connection.capabilities
  }

  abstract discoverModels(signal?: AbortSignal): Promise<string[]>
  abstract generate(request: ProviderGenerateRequest, options?: GenerateOptions): Promise<StreamAccumulator>

  protected emit(accumulator: StreamAccumulator, delta: string, options?: GenerateOptions): void {
    accumulator.text += delta
    options?.onTextDelta?.(delta)
  }
}

class OpenAiResponsesAdapter extends BaseAdapter {
  async discoverModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.fetcher(joinUrl(this.connection.baseUrl, 'models'), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal
    })
    await assertOk(response)
    const payload = (await response.json()) as { data?: Array<{ id?: string }> }
    return uniqueModels(payload.data?.map((model) => model.id) ?? [])
  }

  async generate(request: ProviderGenerateRequest, options?: GenerateOptions): Promise<StreamAccumulator> {
    const body: Record<string, unknown> = {
      model: request.model,
      input: request.messages.map((message) => ({ role: message.role, content: message.content })),
      stream: true
    }
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.maxOutputTokens) body.max_output_tokens = request.maxOutputTokens
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        strict: true
      }))
    }
    if (request.responseSchema) {
      body.text = {
        format: {
          type: 'json_schema',
          name: request.responseSchema.name,
          schema: request.responseSchema.schema,
          strict: true
        }
      }
    }

    const response = await this.fetcher(joinUrl(this.connection.baseUrl, 'responses'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal
    })
    await assertOk(response)
    const result: StreamAccumulator = { text: '', toolCalls: [], usage: emptyUsage(), model: request.model }
    await readSse(response, (event) => this.consume(event, result, options))
    return result
  }

  private consume(event: Record<string, unknown>, result: StreamAccumulator, options?: GenerateOptions): void {
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') this.emit(result, event.delta, options)
    if (event.type !== 'response.completed') return
    const response = event.response as Record<string, unknown> | undefined
    if (!response) return
    result.model = stringValue(response.model) || result.model
    result.usage = openAiUsage(response.usage)
    result.finishReason = stringValue(response.status)
    const output = Array.isArray(response.output) ? response.output : []
    result.toolCalls = output.flatMap((item) => {
      const call = item as Record<string, unknown>
      if (call.type !== 'function_call') return []
      return [{
        id: stringValue(call.call_id) || stringValue(call.id),
        name: stringValue(call.name),
        arguments: parseArguments(call.arguments)
      }]
    })
  }
}

class AnthropicMessagesAdapter extends BaseAdapter {
  async discoverModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.fetcher(anthropicUrl(this.connection.baseUrl, 'models'), {
      headers: this.headers(),
      signal
    })
    await assertOk(response)
    const payload = (await response.json()) as { data?: Array<{ id?: string }> }
    return uniqueModels(payload.data?.map((model) => model.id) ?? [])
  }

  async generate(request: ProviderGenerateRequest, options?: GenerateOptions): Promise<StreamAccumulator> {
    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }))
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? 4096,
      messages,
      stream: true
    }
    if (system) body.system = system
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }))
    }

    const response = await this.fetcher(anthropicUrl(this.connection.baseUrl, 'messages'), {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal
    })
    await assertOk(response)
    const result: StreamAccumulator = { text: '', toolCalls: [], usage: emptyUsage(), model: request.model }
    const toolBuffers = new Map<number, ProviderToolCall & { raw: string }>()
    await readSse(response, (event) => this.consume(event, result, toolBuffers, options))
    result.toolCalls = [...toolBuffers.values()].map(({ raw, ...call }) => ({ ...call, arguments: parseArguments(raw) }))
    result.usage.totalTokens = result.usage.inputTokens + result.usage.outputTokens
    return result
  }

  private headers(): Record<string, string> {
    return { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }
  }

  private consume(
    event: Record<string, unknown>,
    result: StreamAccumulator,
    toolBuffers: Map<number, ProviderToolCall & { raw: string }>,
    options?: GenerateOptions
  ): void {
    if (event.type === 'message_start') {
      const message = event.message as Record<string, unknown> | undefined
      result.model = stringValue(message?.model) || result.model
      result.usage.inputTokens = numberValue((message?.usage as Record<string, unknown> | undefined)?.input_tokens)
    }
    if (event.type === 'content_block_start') {
      const index = numberValue(event.index)
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use') {
        toolBuffers.set(index, { id: stringValue(block.id), name: stringValue(block.name), arguments: {}, raw: '' })
      }
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') this.emit(result, delta.text, options)
      if (delta?.type === 'input_json_delta') {
        const call = toolBuffers.get(numberValue(event.index))
        if (call) call.raw += stringValue(delta.partial_json)
      }
    }
    if (event.type === 'message_delta') {
      const usage = event.usage as Record<string, unknown> | undefined
      result.usage.outputTokens = numberValue(usage?.output_tokens)
      const delta = event.delta as Record<string, unknown> | undefined
      result.finishReason = stringValue(delta?.stop_reason)
    }
  }
}

class OpenAiCompatibleAdapter extends BaseAdapter {
  async discoverModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.fetcher(joinUrl(this.connection.baseUrl, 'models'), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal
    })
    await assertOk(response)
    const payload = (await response.json()) as { data?: Array<{ id?: string }> }
    return uniqueModels(payload.data?.map((model) => model.id) ?? [])
  }

  async generate(request: ProviderGenerateRequest, options?: GenerateOptions): Promise<StreamAccumulator> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true
    }
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
      }))
    }
    if (request.responseSchema && this.capabilities.structuredOutput) {
      body.response_format = { type: 'json_schema', json_schema: { ...request.responseSchema, strict: true } }
    }

    const response = await this.fetcher(joinUrl(this.connection.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal
    })
    await assertOk(response)
    const result: StreamAccumulator = { text: '', toolCalls: [], usage: emptyUsage(), model: request.model }
    const toolBuffers = new Map<number, ProviderToolCall & { raw: string }>()
    await readSse(response, (event) => this.consume(event, result, toolBuffers, options))
    result.toolCalls = [...toolBuffers.values()].map(({ raw, ...call }) => ({ ...call, arguments: parseArguments(raw) }))
    return result
  }

  private consume(
    event: Record<string, unknown>,
    result: StreamAccumulator,
    toolBuffers: Map<number, ProviderToolCall & { raw: string }>,
    options?: GenerateOptions
  ): void {
    result.model = stringValue(event.model) || result.model
    const usage = event.usage as Record<string, unknown> | undefined
    if (usage) result.usage = openAiUsage(usage)
    const choices = Array.isArray(event.choices) ? event.choices : []
    for (const rawChoice of choices) {
      const choice = rawChoice as Record<string, unknown>
      result.finishReason = stringValue(choice.finish_reason) || result.finishReason
      const delta = choice.delta as Record<string, unknown> | undefined
      if (typeof delta?.content === 'string') this.emit(result, delta.content, options)
      const calls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : []
      for (const rawCall of calls) {
        const call = rawCall as Record<string, unknown>
        const index = numberValue(call.index)
        const current = toolBuffers.get(index) ?? { id: '', name: '', arguments: {}, raw: '' }
        current.id ||= stringValue(call.id)
        const fn = call.function as Record<string, unknown> | undefined
        current.name ||= stringValue(fn?.name)
        current.raw += stringValue(fn?.arguments)
        toolBuffers.set(index, current)
      }
    }
  }
}

function uniqueModels(models: Array<string | undefined>): string[] {
  return [...new Set(models.filter((model): model is string => Boolean(model)))].sort((a, b) => a.localeCompare(b))
}

function openAiUsage(value: unknown): ProviderUsage {
  const usage = value as Record<string, unknown> | undefined
  const inputTokens = numberValue(usage?.input_tokens ?? usage?.prompt_tokens)
  const outputTokens = numberValue(usage?.output_tokens ?? usage?.completion_tokens)
  return { inputTokens, outputTokens, totalTokens: numberValue(usage?.total_tokens) || inputTokens + outputTokens }
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed }
  } catch {
    return { raw: value }
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}


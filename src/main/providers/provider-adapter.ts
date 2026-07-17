import type {
  ProviderCapabilities,
  ProviderGenerateRequest,
  ProviderGenerateResult,
  ProviderToolCall,
  ProviderUsage
} from '../../shared/contracts'

export type FetchLike = typeof fetch

export interface GenerateOptions {
  signal?: AbortSignal
  onTextDelta?: (delta: string) => void
}

export interface ProviderAdapter {
  readonly capabilities: ProviderCapabilities
  discoverModels(signal?: AbortSignal): Promise<string[]>
  generate(request: ProviderGenerateRequest, options?: GenerateOptions): Promise<ProviderGenerateResult>
}

export interface StreamAccumulator {
  text: string
  toolCalls: ProviderToolCall[]
  usage: ProviderUsage
  model: string
  finishReason?: string
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false
  ) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function anthropicUrl(baseUrl: string, path: string): string {
  return joinUrl(baseUrl.replace(/\/v1\/?$/, ''), `v1/${path}`)
}

export async function assertOk(response: Response): Promise<void> {
  if (response.ok) return
  let detail = response.statusText || 'Request failed'
  try {
    const payload = (await response.json()) as { error?: { message?: string } | string; message?: string }
    detail = typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message || detail
  } catch {
    // Some compatible endpoints return an empty or non-JSON error body.
  }
  throw new ProviderRequestError(detail, response.status, response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500)
}

export async function readSse(response: Response, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  if (!response.body) throw new ProviderRequestError('Provider returned an empty streaming response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) parseSseBlock(block, onEvent)
    if (done) break
  }
  if (buffer.trim()) parseSseBlock(buffer, onEvent)
}

function parseSseBlock(block: string, onEvent: (event: Record<string, unknown>) => void): void {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data || data === '[DONE]') return
  try {
    onEvent(JSON.parse(data) as Record<string, unknown>)
  } catch {
    throw new ProviderRequestError('Provider returned malformed streaming data')
  }
}

export function emptyUsage(): ProviderUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}


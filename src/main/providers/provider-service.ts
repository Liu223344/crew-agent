import type { ProviderGenerateRequest, ProviderGenerateResult, ProviderProbeResult } from '../../shared/contracts'
import { BossyDatabase } from '../database'
import { createProviderAdapter } from './adapters'
import type { GenerateOptions } from './provider-adapter'

export class ProviderService {
  constructor(private readonly database: BossyDatabase) {}

  async probe(providerId: string): Promise<ProviderProbeResult> {
    const connection = this.database.getProvider(providerId)
    if (!connection) throw new Error('Provider connection not found')
    const apiKey = this.database.getProviderSecret(providerId)
    if (!apiKey) throw new Error('请先保存 API Key')
    const startedAt = performance.now()
    try {
      const models = await createProviderAdapter(connection, apiKey).discoverModels(AbortSignal.timeout(15_000))
      const result: ProviderProbeResult = {
        providerId,
        ok: true,
        models,
        latencyMs: Math.round(performance.now() - startedAt),
        capabilities: connection.capabilities,
        message: models.length ? `连接成功，发现 ${models.length} 个模型` : '连接成功，但服务未返回模型列表'
      }
      this.database.updateProviderProbe(providerId, result)
      return result
    } catch (error) {
      const result: ProviderProbeResult = {
        providerId,
        ok: false,
        models: connection.models,
        latencyMs: Math.round(performance.now() - startedAt),
        capabilities: connection.capabilities,
        message: safeErrorMessage(error)
      }
      this.database.updateProviderProbe(providerId, result)
      return result
    }
  }

  async generate(
    providerId: string,
    request: ProviderGenerateRequest,
    options?: GenerateOptions
  ): Promise<ProviderGenerateResult> {
    const connection = this.database.getProvider(providerId)
    if (!connection) throw new Error(`Provider connection ${providerId} not found`)
    const apiKey = this.database.getProviderSecret(providerId)
    if (!apiKey) throw new Error(`Provider connection ${connection.name} has no API key`)
    return createProviderAdapter(connection, apiKey).generate(request, options)
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return '连接超时，请检查网络、Base URL 或代理设置'
    return error.message.slice(0, 300)
  }
  return '连接失败，请检查配置'
}


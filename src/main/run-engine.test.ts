import { describe, expect, it } from 'vitest'
import type { AppSnapshot, ProviderGenerateRequest, ProviderGenerateResult, TeamDefinition } from '../shared/contracts'
import type { BossyDatabase } from './database'
import type { McpService } from './mcp/mcp-service'
import { ProviderRequestError } from './providers/provider-adapter'
import type { ProviderService } from './providers/provider-service'
import { RunEngine } from './run-engine'

describe('RunEngine orchestration', () => {
  it('asks the chief to correct an invalid plan once', async () => {
    const team = makeTeam(false)
    let planningCalls = 0
    const providers = providerFake(async (_providerId, request) => {
      if (!request.responseSchema) return result('done', request.model)
      planningCalls += 1
      return result(planningCalls === 1 ? '{"message":"not a plan"}' : planFor(team, false), request.model)
    })
    const database = memoryDatabase(team)
    const engine = new RunEngine(database, providers, mcpFake(), () => null)
    const run = await engine.create({ teamId: team.id, objective: 'repair plan', workspacePath: '/tmp', concurrency: 1 }, team)
    expect(run.tasks).toHaveLength(1)
    expect(planningCalls).toBe(2)
  })

  it('runs independent tasks in parallel up to the configured concurrency', async () => {
    const team = makeTeam(false)
    let active = 0
    let maxActive = 0
    const providers = providerFake(async (providerId, request) => {
      if (request.responseSchema) return result(planFor(team, true), request.model)
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 25))
      active -= 1
      return result(`completed by ${providerId}`, request.model, 20)
    })
    const database = memoryDatabase(team)
    const engine = new RunEngine(database, providers, mcpFake(), () => null)
    const run = await engine.create({ teamId: team.id, objective: 'parallel work', workspacePath: '/tmp', concurrency: 2 }, team)
    engine.approve(run.id)
    const completed = await waitForRun(database, run.id, 'completed')
    expect(maxActive).toBe(2)
    expect(completed.tasks.every((task) => task.status === 'completed')).toBe(true)
  })

  it('uses the configured fallback only for retryable provider failures', async () => {
    const team = makeTeam(true)
    const providers = providerFake(async (providerId, request) => {
      if (request.responseSchema) return result(planFor(team, false), request.model)
      if (providerId === 'primary') throw new ProviderRequestError('rate limited', 429, true)
      return result('fallback result', request.model, 15)
    })
    const database = memoryDatabase(team)
    const engine = new RunEngine(database, providers, mcpFake(), () => null)
    const run = await engine.create({ teamId: team.id, objective: 'fallback', workspacePath: '/tmp', concurrency: 1 }, team)
    engine.approve(run.id)
    const completed = await waitForRun(database, run.id, 'completed')
    expect(completed.tasks[0].usedFallback).toBe(true)
    expect(completed.tasks[0].modelId).toBe('backup-model')
    expect(completed.events.some((event) => event.title.includes('备用模型'))).toBe(true)
  })

  it('pauses when the configured task budget is reached', async () => {
    const team = makeTeam(false)
    const providers = providerFake(async (_providerId, request) => request.responseSchema
      ? result(planFor(team, false), request.model, 1)
      : result('costly result', request.model, 1_000))
    const database = memoryDatabase(team, [{ providerId: 'primary', modelId: 'worker-model', inputPerMillion: 10, outputPerMillion: 10 }])
    const engine = new RunEngine(database, providers, mcpFake(), () => null)
    const run = await engine.create({ teamId: team.id, objective: 'budget', workspacePath: '/tmp', concurrency: 1, budget: 0.001 }, team)
    engine.approve(run.id)
    const paused = await waitForRun(database, run.id, 'paused')
    expect(paused.estimatedCost).toBeGreaterThanOrEqual(0.001)
    expect(paused.events.some((event) => event.title.includes('费用额度'))).toBe(true)
  })
})

function makeTeam(withFallback: boolean): TeamDefinition {
  const workerModel = withFallback
    ? { connectionId: 'primary', modelId: 'worker-model', fallbackConnectionId: 'backup', fallbackModelId: 'backup-model', temperature: 0.3 }
    : { connectionId: 'primary', modelId: 'worker-model', temperature: 0.3 }
  return {
    schemaVersion: 1,
    id: 'team',
    name: 'Team',
    description: '',
    chiefAgentId: 'chief',
    concurrency: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'chief', name: 'Chief', role: 'chief', title: 'Chief', instructions: 'Plan', color: '#000', model: { connectionId: 'chief-provider', modelId: 'chief-model', temperature: 0.2 }, tools: [], outputContract: 'Plan' },
      { id: 'worker-a', name: 'Worker A', role: 'custom', title: 'Worker', instructions: 'Work', color: '#000', model: workerModel, tools: [], outputContract: 'Result' },
      { id: 'worker-b', name: 'Worker B', role: 'custom', title: 'Worker', instructions: 'Work', color: '#000', model: workerModel, tools: [], outputContract: 'Result' }
    ]
  }
}

function planFor(team: TeamDefinition, parallel: boolean): string {
  const workers = parallel ? team.agents.slice(1) : team.agents.slice(1, 2)
  return JSON.stringify({ tasks: workers.map((agent, index) => ({ key: `task-${index}`, title: `Task ${index}`, objective: 'Do work', assigneeId: agent.id, dependencies: [], expectedOutput: 'Result', acceptanceCriteria: 'Done' })) })
}

function result(text: string, model: string, tokens = 2): ProviderGenerateResult {
  return { text, toolCalls: [], model, usage: { inputTokens: Math.floor(tokens / 2), outputTokens: Math.ceil(tokens / 2), totalTokens: tokens } }
}

function providerFake(generate: (providerId: string, request: ProviderGenerateRequest) => Promise<ProviderGenerateResult>): ProviderService {
  return { generate } as unknown as ProviderService
}

function mcpFake(): McpService {
  return { definitions: () => [], resolveToolId: () => undefined, toolSummary: () => undefined } as unknown as McpService
}

function memoryDatabase(team: TeamDefinition, pricing: AppSnapshot['settings']['pricing'] = []): BossyDatabase {
  const runs = new Map<string, AppSnapshot['runs'][number]>()
  const snapshot = (): AppSnapshot => ({ teams: [team], providers: [], mcpServers: [], runs: [...runs.values()].map(clone), settings: { language: 'zh-CN', theme: 'light', currency: 'CNY', pricing, approvalPolicy: 'risky' } })
  return {
    snapshot,
    saveRun: (run: AppSnapshot['runs'][number]) => { runs.set(run.id, clone(run)) },
    getRun: (id: string) => { const run = runs.get(id); return run ? clone(run) : undefined }
  } as unknown as BossyDatabase
}

async function waitForRun(database: BossyDatabase, runId: string, status: AppSnapshot['runs'][number]['status']): Promise<AppSnapshot['runs'][number]> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const run = database.getRun(runId)
    if (run?.status === status) return run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Run did not reach ${status}`)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

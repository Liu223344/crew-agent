import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app, safeStorage } from 'electron'
import type {
  AppSettings,
  AppSnapshot,
  ExecutionRun,
  McpProbeResult,
  McpServerDefinition,
  ProviderConnection,
  ProviderProbeResult,
  SaveProviderInput,
  SaveMcpServerInput,
  TeamDefinition
} from '../shared/contracts'

const defaultSettings: AppSettings = {
  language: 'zh-CN',
  theme: 'system',
  currency: 'CNY',
  pricing: [],
  approvalPolicy: 'risky'
}

const providerSeeds: Array<Omit<ProviderConnection, 'updatedAt'>> = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    status: 'unconfigured',
    hasSecret: false,
    models: [],
    capabilities: { streaming: true, toolCalling: true, structuredOutput: true, vision: true }
  },
  {
    id: 'anthropic',
    name: 'Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    status: 'unconfigured',
    hasSecret: false,
    models: [],
    capabilities: { streaming: true, toolCalling: true, structuredOutput: false, vision: true }
  },
  {
    id: 'kimi',
    name: 'Kimi',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    status: 'unconfigured',
    hasSecret: false,
    models: [],
    capabilities: { streaming: true, toolCalling: true, structuredOutput: false, vision: true }
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    status: 'unconfigured',
    hasSecret: false,
    models: [],
    capabilities: { streaming: true, toolCalling: true, structuredOutput: false, vision: false }
  }
]

export class BossyDatabase {
  private readonly db: Database.Database

  constructor() {
    this.db = new Database(join(app.getPath('userData'), 'bossy.db'))
    this.db.pragma('journal_mode = WAL')
    this.migrate()
    this.seed()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        secret BLOB,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_events_run_id_created_at ON run_events (run_id, created_at);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        secret BLOB,
        updated_at TEXT NOT NULL
      );
    `)
  }

  private seed(): void {
    const now = new Date().toISOString()
    const providerCount = this.db.prepare('SELECT COUNT(*) AS count FROM providers').get() as { count: number }
    if (providerCount.count === 0) {
      const insert = this.db.prepare('INSERT INTO providers (id, payload, updated_at) VALUES (?, ?, ?)')
      const transaction = this.db.transaction(() => {
        for (const provider of providerSeeds) {
          insert.run(provider.id, JSON.stringify({ ...provider, updatedAt: now }), now)
        }
      })
      transaction()
    }

    const settingsRow = this.db.prepare('SELECT key FROM settings WHERE key = ?').get('app')
    if (!settingsRow) {
      const language = app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
      this.db.prepare('INSERT INTO settings (key, payload) VALUES (?, ?)').run('app', JSON.stringify({ ...defaultSettings, language }))
    }

    const teamCount = this.db.prepare('SELECT COUNT(*) AS count FROM teams').get() as { count: number }
    if (teamCount.count === 0) this.saveTeam(this.makeBlankTeam())
  }

  makeBlankTeam(): TeamDefinition {
    const now = new Date().toISOString()
    const chiefId = randomUUID()
    return {
      schemaVersion: 1,
      id: randomUUID(),
      name: '我的 Bossy 团队',
      description: '从总指挥开始，添加适合你的 AI 团队成员。',
      chiefAgentId: chiefId,
      concurrency: 3,
      createdAt: now,
      updatedAt: now,
      agents: [
        {
          id: chiefId,
          name: '总指挥',
          role: 'chief',
          title: 'Chief of Staff',
          instructions: '理解老板的目标，拆解任务，分配给最合适的成员，并检查最终交付。',
          color: '#285D50',
          model: { connectionId: 'openai', modelId: '', temperature: 0.3 },
          tools: [],
          outputContract: '输出结构化执行计划、任务验收结果和最终交付摘要。'
        }
      ]
    }
  }

  snapshot(): AppSnapshot {
    const teams = this.db.prepare('SELECT payload FROM teams ORDER BY updated_at DESC').all().map(parsePayload<TeamDefinition>)
    const providers = this.db
      .prepare('SELECT payload, secret FROM providers ORDER BY rowid ASC')
      .all()
      .map((row) => {
        const typed = row as { payload: string; secret: Buffer | null }
        return { ...JSON.parse(typed.payload), hasSecret: Boolean(typed.secret) } as ProviderConnection
      })
    const mcpServers = this.db
      .prepare('SELECT payload, secret FROM mcp_servers ORDER BY updated_at DESC')
      .all()
      .map((row) => {
        const typed = row as { payload: string; secret: Buffer | null }
        return { ...(JSON.parse(typed.payload) as McpServerDefinition), hasSecret: Boolean(typed.secret) }
      })
    const runs = this.db.prepare('SELECT payload FROM runs ORDER BY updated_at DESC').all().map((row) => normalizeRun(parsePayload<ExecutionRun>(row)))
    const settingsRow = this.db.prepare('SELECT payload FROM settings WHERE key = ?').get('app') as { payload: string }
    return { teams, providers, mcpServers, runs, settings: normalizeSettings(JSON.parse(settingsRow.payload) as AppSettings) }
  }

  saveTeam(team: TeamDefinition): void {
    const updated = { ...team, updatedAt: new Date().toISOString() }
    this.db
      .prepare('INSERT INTO teams (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
      .run(updated.id, JSON.stringify(updated), updated.updatedAt)
  }

  deleteTeam(teamId: string): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(teamId)
  }

  saveProvider(input: SaveProviderInput): void {
    const existing = this.db.prepare('SELECT secret FROM providers WHERE id = ?').get(input.id) as { secret: Buffer | null } | undefined
    let secret = existing?.secret ?? null
    if (input.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，Bossy 不会以明文保存 API Key')
      secret = safeStorage.encryptString(input.apiKey)
    }
    const now = new Date().toISOString()
    const payload: ProviderConnection = {
      ...input,
      hasSecret: Boolean(secret),
      status: input.status,
      updatedAt: now
    }
    this.db
      .prepare('INSERT INTO providers (id, payload, secret, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, secret = excluded.secret, updated_at = excluded.updated_at')
      .run(input.id, JSON.stringify(payload), secret, now)
  }

  getProvider(providerId: string): ProviderConnection | undefined {
    const row = this.db.prepare('SELECT payload, secret FROM providers WHERE id = ?').get(providerId) as
      | { payload: string; secret: Buffer | null }
      | undefined
    return row ? { ...(JSON.parse(row.payload) as ProviderConnection), hasSecret: Boolean(row.secret) } : undefined
  }

  getProviderSecret(providerId: string): string | undefined {
    const row = this.db.prepare('SELECT secret FROM providers WHERE id = ?').get(providerId) as { secret: Buffer | null } | undefined
    if (!row?.secret) return undefined
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用')
    return safeStorage.decryptString(row.secret)
  }

  updateProviderProbe(providerId: string, probe: ProviderProbeResult): void {
    const provider = this.getProvider(providerId)
    if (!provider) return
    const now = new Date().toISOString()
    const payload: ProviderConnection = {
      ...provider,
      status: probe.ok ? 'ready' : 'error',
      models: probe.ok ? probe.models : provider.models,
      capabilities: probe.capabilities,
      updatedAt: now
    }
    this.db.prepare('UPDATE providers SET payload = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(payload), now, providerId)
  }

  saveMcpServer(input: SaveMcpServerInput): void {
    const existing = this.db.prepare('SELECT secret FROM mcp_servers WHERE id = ?').get(input.id) as { secret: Buffer | null } | undefined
    let secret = existing?.secret ?? null
    if (input.authToken) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，Bossy 不会以明文保存 MCP Token')
      secret = safeStorage.encryptString(input.authToken)
    }
    const now = new Date().toISOString()
    const payload: McpServerDefinition = { ...input, hasSecret: Boolean(secret), updatedAt: now }
    this.db.prepare('INSERT INTO mcp_servers (id, payload, secret, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, secret = excluded.secret, updated_at = excluded.updated_at').run(input.id, JSON.stringify(payload), secret, now)
  }

  getMcpServer(serverId: string): McpServerDefinition | undefined {
    const row = this.db.prepare('SELECT payload, secret FROM mcp_servers WHERE id = ?').get(serverId) as { payload: string; secret: Buffer | null } | undefined
    return row ? { ...(JSON.parse(row.payload) as McpServerDefinition), hasSecret: Boolean(row.secret) } : undefined
  }

  getMcpSecret(serverId: string): string | undefined {
    const row = this.db.prepare('SELECT secret FROM mcp_servers WHERE id = ?').get(serverId) as { secret: Buffer | null } | undefined
    if (!row?.secret) return undefined
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用')
    return safeStorage.decryptString(row.secret)
  }

  updateMcpProbe(serverId: string, probe: McpProbeResult): void {
    const server = this.getMcpServer(serverId)
    if (!server) return
    const now = new Date().toISOString()
    const payload: McpServerDefinition = { ...server, status: probe.ok ? 'ready' : 'error', tools: probe.ok ? probe.tools : server.tools, updatedAt: now }
    this.db.prepare('UPDATE mcp_servers SET payload = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(payload), now, serverId)
  }

  deleteMcpServer(serverId: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(serverId)
  }

  saveRun(run: ExecutionRun): void {
    const updated = { ...run, updatedAt: new Date().toISOString() }
    const saveRun = this.db.prepare('INSERT INTO runs (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
    const appendEvent = this.db.prepare('INSERT OR IGNORE INTO run_events (id, run_id, payload, created_at) VALUES (?, ?, ?, ?)')
    this.db.transaction(() => {
      saveRun.run(updated.id, JSON.stringify(updated), updated.updatedAt)
      for (const event of updated.events) appendEvent.run(event.id, updated.id, JSON.stringify(event), event.createdAt)
    })()
  }

  getRun(runId: string): ExecutionRun | undefined {
    const row = this.db.prepare('SELECT payload FROM runs WHERE id = ?').get(runId) as { payload: string } | undefined
    return row ? normalizeRun(JSON.parse(row.payload) as ExecutionRun) : undefined
  }

  saveSettings(settings: AppSettings): void {
    this.db.prepare('UPDATE settings SET payload = ? WHERE key = ?').run(JSON.stringify(settings), 'app')
  }

  recoverInterruptedRuns(): void {
    const runs = this.db.prepare('SELECT payload FROM runs').all().map(parsePayload<ExecutionRun>)
    for (const run of runs) {
      if (recoverInterruptedRun(run)) this.saveRun(normalizeRun(run))
    }
  }
}

function parsePayload<T>(row: unknown): T {
  return JSON.parse((row as { payload: string }).payload) as T
}

function normalizeRun(run: ExecutionRun): ExecutionRun {
  return { ...run, approvals: run.approvals ?? [], agentCosts: run.agentCosts ?? {}, messages: run.messages ?? [], attachments: run.attachments ?? [], artifacts: run.artifacts ?? [] }
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return { ...defaultSettings, ...settings, pricing: settings.pricing ?? [] }
}

export function recoverInterruptedRun(run: ExecutionRun): boolean {
  if (run.status !== 'running') return false
  run.status = 'paused'
  for (const task of run.tasks) {
    if (task.status === 'running') {
      task.status = 'queued'
      task.progress = 0
    }
  }
  run.events.unshift({
    id: randomUUID(),
    runId: run.id,
    type: 'status',
    title: '任务已从异常中恢复',
    detail: '应用上次退出时仍有步骤执行中，已暂停并标记为可重试。',
    createdAt: new Date().toISOString()
  })
  return true
}

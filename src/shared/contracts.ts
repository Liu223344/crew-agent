export type AgentRole = 'chief' | 'research' | 'writer' | 'designer' | 'developer' | 'reviewer' | 'custom'

export type AgentStatus =
  | 'idle'
  | 'planning'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'failed'
  | 'completed'

export type ProviderKind = 'openai' | 'anthropic' | 'openai-compatible'
export type ProviderStatus = 'unconfigured' | 'ready' | 'error'
export type RunStatus = 'draft' | 'awaiting_approval' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type TaskStatus = 'queued' | 'running' | 'blocked' | 'completed' | 'failed'

export interface ModelBinding {
  connectionId: string
  modelId: string
  fallbackConnectionId?: string
  fallbackModelId?: string
  temperature: number
}

export interface AgentDefinition {
  id: string
  name: string
  role: AgentRole
  title: string
  instructions: string
  color: string
  avatar?: string
  model: ModelBinding
  tools: string[]
  outputContract: string
}

export interface TeamDefinition {
  schemaVersion: 1
  id: string
  name: string
  description: string
  chiefAgentId: string
  agents: AgentDefinition[]
  concurrency: number
  defaultBudget?: number
  createdAt: string
  updatedAt: string
}

export interface ProviderCapabilities {
  streaming: boolean
  toolCalling: boolean
  structuredOutput: boolean
  vision: boolean
}

export interface ProviderConnection {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  status: ProviderStatus
  hasSecret: boolean
  models: string[]
  capabilities: ProviderCapabilities
  updatedAt: string
}

export interface PlanTask {
  id: string
  title: string
  objective: string
  assigneeId: string
  dependencies: string[]
  expectedOutput: string
  acceptanceCriteria: string
  status: TaskStatus
  progress: number
}

export interface RunEvent {
  id: string
  runId: string
  type: 'plan' | 'status' | 'message' | 'tool' | 'approval' | 'artifact' | 'usage'
  agentId?: string
  taskId?: string
  title: string
  detail: string
  createdAt: string
}

export interface ExecutionRun {
  schemaVersion: 1
  id: string
  teamId: string
  title: string
  objective: string
  workspacePath: string
  status: RunStatus
  concurrency: number
  budget?: number
  usedTokens: number
  estimatedCost: number
  planVersion: number
  tasks: PlanTask[]
  events: RunEvent[]
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  language: 'zh-CN' | 'en'
  theme: 'light' | 'dark' | 'system'
  currency: 'CNY' | 'USD'
}

export interface AppSnapshot {
  teams: TeamDefinition[]
  providers: ProviderConnection[]
  runs: ExecutionRun[]
  settings: AppSettings
}

export interface CreateRunInput {
  teamId: string
  objective: string
  workspacePath: string
  concurrency: number
  budget?: number
}

export interface SaveProviderInput extends Omit<ProviderConnection, 'hasSecret' | 'updatedAt'> {
  apiKey?: string
}

export interface BossyApi {
  getSnapshot(): Promise<AppSnapshot>
  saveTeam(team: TeamDefinition): Promise<AppSnapshot>
  deleteTeam(teamId: string): Promise<AppSnapshot>
  createBlankTeam(): Promise<AppSnapshot>
  saveProvider(provider: SaveProviderInput): Promise<AppSnapshot>
  createRun(input: CreateRunInput): Promise<ExecutionRun>
  approveRun(runId: string): Promise<void>
  setRunStatus(runId: string, status: 'paused' | 'running' | 'cancelled'): Promise<void>
  openDirectory(): Promise<string | null>
  saveSettings(settings: AppSettings): Promise<AppSnapshot>
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void
}

export const roleLabels: Record<AgentRole, { zh: string; en: string }> = {
  chief: { zh: '总指挥', en: 'Chief of Staff' },
  research: { zh: '研究', en: 'Research' },
  writer: { zh: '文案', en: 'Writer' },
  designer: { zh: '设计', en: 'Designer' },
  developer: { zh: '开发', en: 'Developer' },
  reviewer: { zh: '审阅', en: 'Reviewer' },
  custom: { zh: '自定义', en: 'Custom' }
}

export const statusLabels: Record<AgentStatus, { zh: string; en: string }> = {
  idle: { zh: '空闲', en: 'Idle' },
  planning: { zh: '规划中', en: 'Planning' },
  queued: { zh: '排队中', en: 'Queued' },
  running: { zh: '运行中', en: 'Running' },
  waiting: { zh: '等待批准', en: 'Needs approval' },
  blocked: { zh: '已阻塞', en: 'Blocked' },
  failed: { zh: '失败', en: 'Failed' },
  completed: { zh: '已完成', en: 'Completed' }
}


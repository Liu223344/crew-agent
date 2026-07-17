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
  budgetLimit?: number
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

export type McpTransportKind = 'stdio' | 'http'
export type McpServerStatus = 'unconfigured' | 'ready' | 'error'

export interface McpToolSummary {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
}

export interface McpServerDefinition {
  id: string
  name: string
  transport: McpTransportKind
  command?: string
  args: string[]
  url?: string
  status: McpServerStatus
  hasSecret: boolean
  tools: McpToolSummary[]
  updatedAt: string
}

export interface SaveMcpServerInput extends Omit<McpServerDefinition, 'hasSecret' | 'updatedAt'> {
  authToken?: string
}

export interface McpProbeResult {
  serverId: string
  ok: boolean
  tools: McpToolSummary[]
  message: string
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
  result?: string
  providerId?: string
  modelId?: string
  usedFallback?: boolean
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

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ToolApproval {
  id: string
  fingerprint: string
  runId: string
  taskId: string
  agentId: string
  toolName: string
  arguments: Record<string, unknown>
  summary: string
  risk: 'read' | 'write' | 'terminal' | 'network'
  status: ApprovalStatus
  createdAt: string
  resolvedAt?: string
}

export interface RunMessage {
  id: string
  runId: string
  agentId: string
  content: string
  status: 'pending' | 'delivered'
  createdAt: string
  deliveredAt?: string
}

export interface AttachmentRecord {
  name: string
  path: string
  type: string
  size: number
  sha256: string
}

export interface ArtifactRecord {
  id: string
  runId: string
  taskId: string
  agentId: string
  path: string
  type: string
  sha256: string
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
  approvals: ToolApproval[]
  agentCosts: Record<string, number>
  messages: RunMessage[]
  attachments: AttachmentRecord[]
  artifacts: ArtifactRecord[]
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  language: 'zh-CN' | 'en'
  theme: 'light' | 'dark' | 'system'
  currency: 'CNY' | 'USD'
  pricing: ModelPrice[]
  approvalPolicy: 'risky' | 'all-tools'
}

export interface ModelPrice {
  providerId: string
  modelId: string
  inputPerMillion: number
  outputPerMillion: number
}

export interface AppSnapshot {
  teams: TeamDefinition[]
  providers: ProviderConnection[]
  mcpServers: McpServerDefinition[]
  runs: ExecutionRun[]
  settings: AppSettings
}

export interface CreateRunInput {
  teamId: string
  objective: string
  workspacePath: string
  concurrency: number
  budget?: number
  attachmentPaths?: string[]
}

export interface UpdateRunTaskInput {
  title: string
  objective: string
  assigneeId: string
  expectedOutput: string
  acceptanceCriteria: string
}

export interface SaveProviderInput extends Omit<ProviderConnection, 'hasSecret' | 'updatedAt'> {
  apiKey?: string
}

export interface ProviderProbeResult {
  providerId: string
  ok: boolean
  models: string[]
  latencyMs: number
  capabilities: ProviderCapabilities
  message: string
}

export type ProviderMessageRole = 'system' | 'user' | 'assistant'

export interface ProviderMessage {
  role: ProviderMessageRole
  content: string
}

export interface ProviderToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ProviderGenerateRequest {
  model: string
  messages: ProviderMessage[]
  temperature?: number
  maxOutputTokens?: number
  tools?: ProviderToolDefinition[]
  responseSchema?: {
    name: string
    schema: Record<string, unknown>
  }
}

export interface ProviderToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ProviderUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ProviderGenerateResult {
  text: string
  toolCalls: ProviderToolCall[]
  usage: ProviderUsage
  model: string
  finishReason?: string
}

export interface BossyApi {
  getSnapshot(): Promise<AppSnapshot>
  saveTeam(team: TeamDefinition): Promise<AppSnapshot>
  deleteTeam(teamId: string): Promise<AppSnapshot>
  createBlankTeam(): Promise<AppSnapshot>
  saveProvider(provider: SaveProviderInput): Promise<AppSnapshot>
  testProvider(providerId: string): Promise<ProviderProbeResult>
  saveMcpServer(server: SaveMcpServerInput): Promise<AppSnapshot>
  testMcpServer(serverId: string): Promise<McpProbeResult>
  deleteMcpServer(serverId: string): Promise<AppSnapshot>
  exportTeam(teamId: string): Promise<string | null>
  importTeam(): Promise<AppSnapshot | null>
  createRun(input: CreateRunInput): Promise<ExecutionRun>
  approveRun(runId: string): Promise<void>
  setRunStatus(runId: string, status: 'paused' | 'running' | 'cancelled'): Promise<void>
  resolveApproval(runId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<void>
  sendRunMessage(runId: string, agentId: string, content: string): Promise<void>
  updateRunTask(runId: string, taskId: string, patch: UpdateRunTaskInput): Promise<void>
  openDirectory(): Promise<string | null>
  openAttachments(): Promise<string[]>
  exportData(): Promise<string | null>
  importData(): Promise<AppSnapshot | null>
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

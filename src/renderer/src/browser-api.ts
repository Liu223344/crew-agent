import type {
  AgentDefinition,
  AppSnapshot,
  BossyApi,
  CreateRunInput,
  ExecutionRun,
  SaveProviderInput,
  TeamDefinition
} from '@shared/contracts'

const now = new Date().toISOString()
const chief = makeAgent('chief', '总指挥', 'Chief of Staff', '#285D50', 'openai', 'gpt-main')
const research = makeAgent('research', '市场研究员', 'Research Lead', '#3568A8', 'kimi', 'kimi-research')
const writer = makeAgent('writer', '内容策划', 'Content Strategist', '#8B5E9D', 'anthropic', 'claude-writer')
const developer = makeAgent('developer', '开发工程师', 'Software Engineer', '#347B65', 'deepseek', 'deepseek-coder')

let snapshot: AppSnapshot = {
  teams: [{
    schemaVersion: 1,
    id: 'browser-team',
    name: 'Bossy 产品团队',
    description: '由不同模型驱动的跨职能 AI 团队。',
    chiefAgentId: chief.id,
    agents: [chief, research, writer, developer],
    concurrency: 3,
    createdAt: now,
    updatedAt: now
  }],
  providers: [
    provider('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', true),
    provider('anthropic', 'Claude', 'anthropic', 'https://api.anthropic.com', true),
    provider('kimi', 'Kimi', 'openai-compatible', 'https://api.moonshot.cn/v1', false),
    provider('deepseek', 'DeepSeek', 'openai-compatible', 'https://api.deepseek.com', true)
  ],
  runs: [],
  settings: { language: 'zh-CN', theme: 'light', currency: 'CNY' }
}

const listeners = new Set<(value: AppSnapshot) => void>()

export function createBrowserApi(): BossyApi {
  return {
    getSnapshot: async () => clone(snapshot),
    saveTeam: async (team) => update({ ...snapshot, teams: [team, ...snapshot.teams.filter((item) => item.id !== team.id)] }),
    deleteTeam: async (teamId) => update({ ...snapshot, teams: snapshot.teams.filter((team) => team.id !== teamId) }),
    createBlankTeam: async () => {
      const newChief = makeAgent('chief', '总指挥', 'Chief of Staff', '#285D50', 'openai', '')
      const team: TeamDefinition = { schemaVersion: 1, id: crypto.randomUUID(), name: '未命名团队', description: '添加你的 AI 团队成员。', chiefAgentId: newChief.id, agents: [newChief], concurrency: 3, createdAt: now, updatedAt: now }
      return update({ ...snapshot, teams: [team, ...snapshot.teams] })
    },
    saveProvider: async (input: SaveProviderInput) => update({ ...snapshot, providers: [{ ...input, hasSecret: Boolean(input.apiKey), status: input.apiKey ? 'ready' : input.status, updatedAt: new Date().toISOString() }, ...snapshot.providers.filter((item) => item.id !== input.id)] }),
    createRun: async (input: CreateRunInput) => {
      const team = snapshot.teams.find((item) => item.id === input.teamId)!
      const first = crypto.randomUUID()
      const workerTasks = team.agents.filter((agent) => agent.id !== team.chiefAgentId).map((agent) => ({ id: crypto.randomUUID(), title: `${agent.name}：完成专业分工`, objective: agent.instructions, assigneeId: agent.id, dependencies: [first], expectedOutput: agent.outputContract, acceptanceCriteria: '成果完整并可交接', status: 'queued' as const, progress: 0 }))
      const run: ExecutionRun = { schemaVersion: 1, id: crypto.randomUUID(), teamId: team.id, title: input.objective.slice(0, 42), objective: input.objective, workspacePath: input.workspacePath, status: 'awaiting_approval', concurrency: input.concurrency, budget: input.budget, usedTokens: 0, estimatedCost: 0, planVersion: 1, tasks: [{ id: first, title: '明确目标与验收标准', objective: '整理任务范围和最终交付标准。', assigneeId: team.chiefAgentId, dependencies: [], expectedOutput: '任务简报', acceptanceCriteria: '目标清晰可执行', status: 'queued', progress: 0 }, ...workerTasks, { id: crypto.randomUUID(), title: '汇总、检查并交付', objective: '检查所有成员成果并生成最终交付。', assigneeId: team.chiefAgentId, dependencies: workerTasks.map((task) => task.id), expectedOutput: '最终交付包', acceptanceCriteria: '所有验收项通过', status: 'queued', progress: 0 }], events: [{ id: crypto.randomUUID(), runId: '', type: 'plan', agentId: team.chiefAgentId, title: '执行计划已生成', detail: '等待老板批准后开始执行。', createdAt: new Date().toISOString() }], createdAt: now, updatedAt: now }
      run.events[0].runId = run.id
      update({ ...snapshot, runs: [run, ...snapshot.runs] })
      return clone(run)
    },
    approveRun: async (runId) => {
      mutateRun(runId, (run) => { run.status = 'running' })
      simulate(runId)
    },
    setRunStatus: async (runId, status) => mutateRun(runId, (run) => { run.status = status }),
    openDirectory: async () => '/Users/liu/Desktop/Bossy Workspace',
    saveSettings: async (settings) => update({ ...snapshot, settings }),
    onSnapshot: (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
  }
}

function simulate(runId: string): void {
  const run = snapshot.runs.find((item) => item.id === runId)
  if (!run) return
  run.tasks.forEach((task, index) => {
    setTimeout(() => mutateRun(runId, (value) => { const item = value.tasks.find((candidate) => candidate.id === task.id)!; item.status = 'running'; item.progress = 45; value.usedTokens += 480; value.estimatedCost += 0.04 }), 500 + index * 850)
    setTimeout(() => mutateRun(runId, (value) => { const item = value.tasks.find((candidate) => candidate.id === task.id)!; item.status = 'completed'; item.progress = 100; value.events.unshift({ id: crypto.randomUUID(), runId, type: 'artifact', agentId: item.assigneeId, taskId: item.id, title: `${item.title}已完成`, detail: item.expectedOutput, createdAt: new Date().toISOString() }); if (value.tasks.every((candidate) => candidate.status === 'completed')) value.status = 'completed' }), 1200 + index * 850)
  })
}

function mutateRun(runId: string, mutation: (run: ExecutionRun) => void): void {
  const runs = snapshot.runs.map((run) => { if (run.id !== runId) return run; const next = clone(run); mutation(next); next.updatedAt = new Date().toISOString(); return next })
  update({ ...snapshot, runs })
}

function update(next: AppSnapshot): AppSnapshot {
  snapshot = next
  for (const listener of listeners) listener(clone(snapshot))
  return clone(snapshot)
}

function makeAgent(role: AgentDefinition['role'], name: string, title: string, color: string, connectionId: string, modelId: string): AgentDefinition {
  return { id: crypto.randomUUID(), name, role, title, color, instructions: `以${title}的身份完成总指挥分配的工作。`, model: { connectionId, modelId, temperature: 0.4 }, tools: [], outputContract: '提交结构化成果、文件位置和交接说明。' }
}

function provider(id: string, name: string, kind: 'openai' | 'anthropic' | 'openai-compatible', baseUrl: string, ready: boolean) {
  return { id, name, kind, baseUrl, status: ready ? 'ready' as const : 'unconfigured' as const, hasSecret: ready, models: [], capabilities: { streaming: true, toolCalling: true, structuredOutput: kind === 'openai', vision: kind !== 'openai-compatible' }, updatedAt: now }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

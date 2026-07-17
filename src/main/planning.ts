import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AttachmentRecord, PlanTask, TeamDefinition } from '../shared/contracts'

const planDraftSchema = z.object({
  tasks: z.array(z.object({
    key: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
    objective: z.string().min(1),
    assigneeId: z.string().min(1),
    dependencies: z.array(z.string()),
    expectedOutput: z.string().min(1),
    acceptanceCriteria: z.string().min(1)
  })).min(1).max(30)
})

export const executionPlanJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'objective', 'assigneeId', 'dependencies', 'expectedOutput', 'acceptanceCriteria'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          objective: { type: 'string' },
          assigneeId: { type: 'string' },
          dependencies: { type: 'array', items: { type: 'string' } },
          expectedOutput: { type: 'string' },
          acceptanceCriteria: { type: 'string' }
        }
      }
    }
  }
}

export function planningPrompt(team: TeamDefinition, objective: string, workspacePath: string, attachments: AttachmentRecord[] = []): string {
  const roster = team.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    title: agent.title,
    responsibilities: agent.instructions,
    outputContract: agent.outputContract,
    tools: agent.tools
  }))
  return [
    '你是 Bossy 团队的总指挥。把老板的目标拆解为可以并行执行、可验证、能交接的任务 DAG。',
    '只能把任务分配给名单内已有 Agent，assigneeId 必须逐字使用名单中的 id。',
    'dependencies 使用任务 key，不得引用未知任务或形成循环。',
    '计划应包含必要的前置分析、成员专业工作，以及由总指挥负责的最终汇总和验收。',
    '不要假设未授权的工具或目录；每个任务写清预期产物与验收标准。',
    `老板目标：${objective}`,
    `工作目录：${workspacePath || '未选择，仅允许输出文本计划'}`,
    `输入附件：${JSON.stringify(attachments.map((attachment) => ({ name: attachment.name, path: attachment.path, type: attachment.type, size: attachment.size })))}`,
    `并发上限：${team.concurrency}`,
    `团队名单：${JSON.stringify(roster)}`,
    '只输出 JSON 对象，不要使用 Markdown 代码块或添加解释。',
    '必须严格使用以下结构：',
    JSON.stringify({
      tasks: [{
        key: 'unique-task-key',
        title: '任务标题',
        objective: '具体目标',
        assigneeId: '团队名单中的完整 Agent id',
        dependencies: ['其他任务 key；没有依赖时为空数组'],
        expectedOutput: '预期产物',
        acceptanceCriteria: '可验证的验收标准'
      }]
    })
  ].join('\n\n')
}

export function parseExecutionPlan(text: string, team: TeamDefinition): PlanTask[] {
  const value = JSON.parse(extractJson(text)) as unknown
  const parsed = planDraftSchema.parse(normalizePlanShape(value))
  const keys = new Set<string>()
  for (const task of parsed.tasks) {
    if (keys.has(task.key)) throw new Error(`执行计划包含重复任务 key: ${task.key}`)
    keys.add(task.key)
  }
  const agents = new Set(team.agents.map((agent) => agent.id))
  for (const task of parsed.tasks) {
    if (!agents.has(task.assigneeId)) throw new Error(`执行计划引用了团队外 Agent: ${task.assigneeId}`)
    for (const dependency of task.dependencies) {
      if (!keys.has(dependency)) throw new Error(`任务 ${task.key} 引用了未知依赖 ${dependency}`)
      if (dependency === task.key) throw new Error(`任务 ${task.key} 不能依赖自身`)
    }
  }
  const ids = new Map(parsed.tasks.map((task) => [task.key, randomUUID()]))
  const tasks: PlanTask[] = parsed.tasks.map((task) => ({
    id: ids.get(task.key)!,
    title: task.title,
    objective: task.objective,
    assigneeId: task.assigneeId,
    dependencies: task.dependencies.map((dependency) => ids.get(dependency)!),
    expectedOutput: task.expectedOutput,
    acceptanceCriteria: task.acceptanceCriteria,
    status: 'queued',
    progress: 0
  }))
  groupTasksByDependency(tasks)
  return tasks
}

function normalizePlanShape(value: unknown): unknown {
  if (Array.isArray(value)) return { tasks: value }
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  if (Array.isArray(object.tasks)) return object
  for (const key of ['plan', 'executionPlan', 'execution_plan', 'taskPlan', 'task_plan']) {
    const nested = object[key]
    if (Array.isArray(nested)) return { tasks: nested }
    if (nested && typeof nested === 'object' && Array.isArray((nested as Record<string, unknown>).tasks)) return nested
  }
  return value
}

export function createExecutionPlan(team: TeamDefinition): PlanTask[] {
  const chief = team.agents.find((agent) => agent.id === team.chiefAgentId) ?? team.agents[0]
  const workers = team.agents.filter((agent) => agent.id !== chief.id)
  const firstTaskId = randomUUID()
  const tasks: PlanTask[] = [
    {
      id: firstTaskId,
      title: '明确目标与验收标准',
      objective: '整理需求、约束、工作目录和最终交付标准。',
      assigneeId: chief.id,
      dependencies: [],
      expectedOutput: '任务简报',
      acceptanceCriteria: '目标、范围、风险和交付形式清晰可执行。',
      status: 'queued',
      progress: 0
    }
  ]

  if (workers.length === 0) {
    tasks.push({
      id: randomUUID(),
      title: '完成核心工作',
      objective: '由总指挥独立完成目标，并准备交付。',
      assigneeId: chief.id,
      dependencies: [firstTaskId],
      expectedOutput: '主要交付文件',
      acceptanceCriteria: '产物满足任务简报中的验收标准。',
      status: 'queued',
      progress: 0
    })
  } else {
    for (const worker of workers) {
      tasks.push({
        id: randomUUID(),
        title: `${worker.name}：完成专业分工`,
        objective: worker.instructions || `根据 ${worker.title} 的职责完成分配工作。`,
        assigneeId: worker.id,
        dependencies: [firstTaskId],
        expectedOutput: worker.outputContract || '可交接的结构化成果',
        acceptanceCriteria: '成果完整、可验证，并能交接给总指挥。',
        status: 'queued',
        progress: 0
      })
    }
  }

  tasks.push({
    id: randomUUID(),
    title: '汇总、检查并交付',
    objective: '检查成员成果，处理冲突，生成最终交付摘要。',
    assigneeId: chief.id,
    dependencies: tasks.slice(1).map((task) => task.id),
    expectedOutput: '最终交付包',
    acceptanceCriteria: '所有验收项通过，产物位置和使用方式明确。',
    status: 'queued',
    progress: 0
  })
  return tasks
}

export function groupTasksByDependency(tasks: PlanTask[]): string[][] {
  const remaining = new Map(tasks.map((task) => [task.id, task]))
  const completed = new Set<string>()
  const groups: string[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((task) => task.dependencies.every((id) => completed.has(id)))
    if (ready.length === 0) throw new Error('Execution plan contains a cycle or missing dependency')
    groups.push(ready.map((task) => task.id))
    for (const task of ready) {
      remaining.delete(task.id)
      completed.add(task.id)
    }
  }
  return groups
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) return fenced
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('总指挥没有返回可解析的 JSON 计划')
}

import { randomUUID } from 'node:crypto'
import type { PlanTask, TeamDefinition } from '../shared/contracts'

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


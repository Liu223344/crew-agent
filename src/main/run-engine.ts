import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { CreateRunInput, ExecutionRun, TeamDefinition } from '../shared/contracts'
import { BossyDatabase } from './database'
import { createExecutionPlan, groupTasksByDependency } from './planning'

export class RunEngine {
  private readonly timers = new Map<string, NodeJS.Timeout[]>()

  constructor(
    private readonly database: BossyDatabase,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  create(input: CreateRunInput, team: TeamDefinition): ExecutionRun {
    const now = new Date().toISOString()
    const runId = randomUUID()
    const tasks = createExecutionPlan(team)
    const run: ExecutionRun = {
      schemaVersion: 1,
      id: runId,
      teamId: team.id,
      title: input.objective.slice(0, 42) || '新任务',
      objective: input.objective,
      workspacePath: input.workspacePath,
      status: 'awaiting_approval',
      concurrency: input.concurrency,
      budget: input.budget,
      usedTokens: 0,
      estimatedCost: 0,
      planVersion: 1,
      tasks,
      events: [
        {
          id: randomUUID(),
          runId,
          type: 'plan',
          agentId: team.chiefAgentId,
          title: '执行计划已生成',
          detail: `总指挥将目标拆解为 ${tasks.length} 个任务，等待老板批准。`,
          createdAt: now
        }
      ],
      createdAt: now,
      updatedAt: now
    }
    this.database.saveRun(run)
    this.broadcast()
    return run
  }

  approve(runId: string): void {
    const run = this.database.getRun(runId)
    if (!run || run.status !== 'awaiting_approval') return
    run.status = 'running'
    run.events.unshift(this.event(run, 'status', '任务开始执行', '团队已收到批准，总指挥开始调度成员。'))
    this.database.saveRun(run)
    this.broadcast()
    this.schedule(runId)
  }

  setStatus(runId: string, status: 'paused' | 'running' | 'cancelled'): void {
    const run = this.database.getRun(runId)
    if (!run) return
    if (status === 'paused') this.clearTimers(runId)
    if (status === 'cancelled') this.clearTimers(runId)
    run.status = status
    run.events.unshift(
      this.event(
        run,
        'status',
        status === 'paused' ? '任务已暂停' : status === 'cancelled' ? '任务已停止' : '任务继续执行',
        status === 'running' ? '调度器正在恢复尚未完成的任务。' : '状态由老板手动更新。'
      )
    )
    this.database.saveRun(run)
    this.broadcast()
    if (status === 'running') this.schedule(runId)
  }

  private schedule(runId: string): void {
    this.clearTimers(runId)
    const timers: NodeJS.Timeout[] = []
    let cursor = 500
    const run = this.database.getRun(runId)
    if (!run) return
    const groups = groupTasksByDependency(run.tasks)

    for (const group of groups) {
      for (const taskId of group) {
        timers.push(setTimeout(() => this.startTask(runId, taskId), cursor))
      }
      cursor += 1500
      for (const taskId of group) {
        timers.push(setTimeout(() => this.finishTask(runId, taskId), cursor))
      }
      cursor += 700
    }
    timers.push(setTimeout(() => this.completeRun(runId), cursor + 300))
    this.timers.set(runId, timers)
  }

  private startTask(runId: string, taskId: string): void {
    const run = this.database.getRun(runId)
    if (!run || run.status !== 'running') return
    const task = run.tasks.find((item) => item.id === taskId)
    if (!task) return
    task.status = 'running'
    task.progress = 38
    run.usedTokens += 420
    run.estimatedCost += 0.03
    run.events.unshift(this.event(run, 'status', task.title, '成员已开始处理任务。', task.assigneeId, task.id))
    this.database.saveRun(run)
    this.broadcast()
  }

  private finishTask(runId: string, taskId: string): void {
    const run = this.database.getRun(runId)
    if (!run || run.status !== 'running') return
    const task = run.tasks.find((item) => item.id === taskId)
    if (!task) return
    task.status = 'completed'
    task.progress = 100
    run.usedTokens += 860
    run.estimatedCost += 0.06
    run.events.unshift(this.event(run, 'artifact', `${task.title}已完成`, task.expectedOutput, task.assigneeId, task.id))
    this.database.saveRun(run)
    this.broadcast()
  }

  private completeRun(runId: string): void {
    const run = this.database.getRun(runId)
    if (!run || run.status !== 'running') return
    run.status = 'completed'
    run.events.unshift(this.event(run, 'status', '任务已完成', '所有计划任务均已完成，最终产物等待老板查看。'))
    this.database.saveRun(run)
    this.clearTimers(runId)
    this.broadcast()
  }

  private event(
    run: ExecutionRun,
    type: 'status' | 'artifact',
    title: string,
    detail: string,
    agentId?: string,
    taskId?: string
  ) {
    return { id: randomUUID(), runId: run.id, type, title, detail, agentId, taskId, createdAt: new Date().toISOString() } as const
  }

  private clearTimers(runId: string): void {
    for (const timer of this.timers.get(runId) ?? []) clearTimeout(timer)
    this.timers.delete(runId)
  }

  private broadcast(): void {
    this.getWindow()?.webContents.send('snapshot:changed', this.database.snapshot())
  }
}

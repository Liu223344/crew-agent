import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import type {
  AgentDefinition,
  CreateRunInput,
  ExecutionRun,
  PlanTask,
  ProviderMessage,
  ProviderGenerateRequest,
  ProviderGenerateResult,
  ProviderUsage,
  RunEvent,
  RunMessage,
  TeamDefinition,
  UpdateRunTaskInput
} from '../shared/contracts'
import { BossyDatabase } from './database'
import { executionPlanJsonSchema, parseExecutionPlan, planningPrompt } from './planning'
import { ProviderRequestError } from './providers/provider-adapter'
import { ProviderService } from './providers/provider-service'
import { McpService } from './mcp/mcp-service'
import { ToolService } from './tools/tool-service'
import { mimeType, prepareAttachments } from './attachments'

interface AgentGeneration extends ProviderGenerateResult {
  providerId: string
  usedFallback: boolean
}

export class RunEngine {
  private readonly activeRuns = new Set<string>()
  private readonly controllers = new Map<string, Set<AbortController>>()
  private readonly taskControllers = new Map<string, AbortController>()
  private readonly tools: ToolService

  constructor(
    private readonly database: BossyDatabase,
    private readonly providers: ProviderService,
    mcp: McpService,
    private readonly getWindow: () => BrowserWindow | null
  ) {
    this.tools = new ToolService(mcp)
  }

  async create(input: CreateRunInput, team: TeamDefinition, cancellation?: AbortSignal): Promise<ExecutionRun> {
    const chief = team.agents.find((agent) => agent.id === team.chiefAgentId)
    if (!chief) throw new Error('团队没有有效的总指挥')
    this.assertAgentModel(chief)
    const attachments = await prepareAttachments(input.attachmentPaths ?? [], input.workspacePath)
    const planMessages: ProviderMessage[] = [
      { role: 'system', content: chief.instructions },
      { role: 'user', content: planningPrompt(team, input.objective, input.workspacePath, attachments) }
    ]
    let generated: AgentGeneration
    try {
      generated = await this.generateForAgent(chief, {
        model: chief.model.modelId,
        messages: planMessages,
        temperature: chief.model.temperature,
        maxOutputTokens: 8192,
        responseSchema: { name: 'execution_plan', schema: executionPlanJsonSchema }
      }, cancellation, undefined, 60_000)
    } catch (error) {
      throw new Error(planningError(error, chief.name), { cause: error })
    }
    const planningUsage = { ...generated.usage }
    let planningCost = this.estimateCost(generated.providerId, generated.model, generated.usage)
    let usedPlanningFallback = generated.usedFallback
    let tasks: PlanTask[]
    try {
      tasks = parseExecutionPlan(generated.text, team)
    } catch (firstError) {
      try {
        const corrected = await this.generateForAgent(chief, {
          model: chief.model.modelId,
          messages: [
            ...planMessages,
            { role: 'assistant', content: generated.text },
            {
              role: 'user',
              content: `上一个输出未通过计划校验：${validationSummary(firstError)}。请纠正格式，只返回顶层包含 tasks 数组的 JSON 对象，字段必须是 key、title、objective、assigneeId、dependencies、expectedOutput、acceptanceCriteria。`
            }
          ],
          temperature: Math.min(chief.model.temperature, 0.3),
          maxOutputTokens: 8192,
          responseSchema: { name: 'execution_plan', schema: executionPlanJsonSchema }
        }, cancellation, undefined, 60_000)
        planningUsage.inputTokens += corrected.usage.inputTokens
        planningUsage.outputTokens += corrected.usage.outputTokens
        planningUsage.totalTokens += corrected.usage.totalTokens
        planningCost += this.estimateCost(corrected.providerId, corrected.model, corrected.usage)
        usedPlanningFallback ||= corrected.usedFallback
        generated = corrected
        tasks = parseExecutionPlan(corrected.text, team)
      } catch (secondError) {
        throw new Error(`${chief.name} 返回的计划格式无效，自动纠正后仍未通过校验：${validationSummary(secondError)}`, { cause: secondError })
      }
    }
    const now = new Date().toISOString()
    const runId = randomUUID()
    const run: ExecutionRun = {
      schemaVersion: 1,
      id: runId,
      teamId: team.id,
      title: input.objective.slice(0, 42) || '新任务',
      objective: input.objective,
      workspacePath: input.workspacePath,
      status: 'awaiting_approval',
      concurrency: Math.max(1, Math.min(input.concurrency, team.concurrency, 8)),
      budget: input.budget,
      usedTokens: planningUsage.totalTokens,
      estimatedCost: planningCost,
      planVersion: 1,
      tasks,
      events: [
        {
          id: randomUUID(),
          runId,
          type: 'plan',
          agentId: chief.id,
          title: '执行计划已生成',
          detail: `总指挥使用 ${generated.model}${usedPlanningFallback ? '（备用模型）' : ''} 将目标拆解为 ${tasks.length} 个任务，等待老板批准。`,
          createdAt: now
        },
        {
          id: randomUUID(),
          runId,
          type: 'usage',
          agentId: chief.id,
          title: '规划用量',
          detail: `${planningUsage.inputTokens} 输入 + ${planningUsage.outputTokens} 输出 tokens`,
          createdAt: now
        }
      ],
      approvals: [],
      agentCosts: { [chief.id]: planningCost },
      messages: [],
      attachments,
      artifacts: [],
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
    void this.schedule(runId)
  }

  setStatus(runId: string, status: 'paused' | 'running' | 'cancelled'): void {
    const run = this.database.getRun(runId)
    if (!run || ['completed', 'failed', 'cancelled'].includes(run.status)) return
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
    if (status === 'paused' || status === 'cancelled') this.abortRun(runId)
    if (status === 'running') void this.schedule(runId)
  }

  resolveApproval(runId: string, approvalId: string, decision: 'approved' | 'rejected'): void {
    const run = this.database.getRun(runId)
    const approval = run?.approvals.find((item) => item.id === approvalId)
    if (!run || !approval || approval.status !== 'pending') return
    approval.status = decision
    approval.resolvedAt = new Date().toISOString()
    const task = run.tasks.find((item) => item.id === approval.taskId)
    if (decision === 'rejected') {
      if (task) task.status = 'failed'
      run.status = 'failed'
      run.events.unshift(this.event(run, 'approval', '风险操作已拒绝', approval.summary, approval.agentId, approval.taskId))
    } else {
      if (task?.status === 'blocked') {
        task.status = 'queued'
        task.progress = 0
      }
      run.status = 'running'
      run.events.unshift(this.event(run, 'approval', '风险操作已批准', approval.summary, approval.agentId, approval.taskId))
    }
    this.database.saveRun(run)
    this.broadcast()
    if (decision === 'approved') void this.schedule(runId)
  }

  sendMessage(runId: string, agentId: string, content: string): void {
    const run = this.database.getRun(runId)
    const team = run ? this.database.snapshot().teams.find((item) => item.id === run.teamId) : undefined
    if (!run || !team?.agents.some((agent) => agent.id === agentId)) throw new Error('目标 Agent 不存在')
    if (['completed', 'failed', 'cancelled'].includes(run.status)) throw new Error('任务已经结束，不能再发送消息')
    const message: RunMessage = { id: randomUUID(), runId, agentId, content: content.trim(), status: 'pending', createdAt: new Date().toISOString() }
    if (!message.content) return
    run.messages.push(message)
    run.events.unshift(this.event(run, 'message', '老板补充了说明', message.content, agentId))
    this.database.saveRun(run)
    this.broadcast()
  }

  updateTask(runId: string, taskId: string, patch: UpdateRunTaskInput): void {
    const run = this.database.getRun(runId)
    const team = run ? this.database.snapshot().teams.find((item) => item.id === run.teamId) : undefined
    const task = run?.tasks.find((item) => item.id === taskId)
    if (!run || !team || !task) throw new Error('任务不存在')
    if (!team.agents.some((agent) => agent.id === patch.assigneeId)) throw new Error('新的负责人不在团队内')
    if (task.status === 'completed' || task.status === 'failed') throw new Error('只能修改尚未完成的任务')
    const wasRunning = task.status === 'running'
    Object.assign(task, patch, { status: 'queued', progress: 0, result: undefined, providerId: undefined, modelId: undefined, usedFallback: undefined })
    run.planVersion += 1
    run.events.unshift(this.event(run, 'plan', '任务已修改', `${patch.title} 已${wasRunning ? '取消当前尝试并' : ''}交给 ${team.agents.find((agent) => agent.id === patch.assigneeId)?.name}。`, patch.assigneeId, taskId))
    this.database.saveRun(run)
    this.broadcast()
    if (wasRunning) this.taskControllers.get(taskKey(runId, taskId))?.abort()
    if (run.status === 'running') void this.schedule(runId)
  }

  private async schedule(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) return
    this.activeRuns.add(runId)
    try {
      while (true) {
        const run = this.database.getRun(runId)
        if (!run || run.status !== 'running') return
        if (run.tasks.every((task) => task.status === 'completed')) {
          this.completeRun(run)
          return
        }
        if (run.tasks.some((task) => task.status === 'failed')) {
          this.failRun(run, '至少一个任务执行失败，请检查时间线后重试。')
          return
        }
        const completed = new Set(run.tasks.filter((task) => task.status === 'completed').map((task) => task.id))
        const ready = run.tasks
          .filter((task) => task.status === 'queued' && task.dependencies.every((dependency) => completed.has(dependency)))
          .slice(0, Math.max(1, run.concurrency))
        if (ready.length === 0) {
          this.failRun(run, '没有可执行任务，计划依赖可能已阻塞。')
          return
        }
        await Promise.all(ready.map((task) => this.executeTask(runId, task.id)))
      }
    } finally {
      this.activeRuns.delete(runId)
      this.controllers.delete(runId)
    }
  }

  private async executeTask(runId: string, taskId: string): Promise<void> {
    let run = this.database.getRun(runId)
    if (!run || run.status !== 'running') return
    const team = this.database.snapshot().teams.find((item) => item.id === run!.teamId)
    const task = run.tasks.find((item) => item.id === taskId)
    const agent = team?.agents.find((item) => item.id === task?.assigneeId)
    if (!team || !task || !agent) {
      if (task) this.failTask(run, task.id, '任务负责人不存在')
      return
    }
    this.assertAgentModel(agent)
    task.status = 'running'
    task.progress = 8
    task.result = ''
    run.events.unshift(this.event(run, 'status', task.title, `${agent.name} 已开始处理任务。`, agent.id, task.id))
    this.database.saveRun(run)
    this.broadcast()

    const controller = new AbortController()
    const runControllers = this.controllers.get(runId) ?? new Set<AbortController>()
    runControllers.add(controller)
    this.controllers.set(runId, runControllers)
    this.taskControllers.set(taskKey(runId, taskId), controller)
    let output = ''
    let lastFlush = 0
    try {
      const latest = this.database.getRun(runId)!
      const dependencyContext = latest.tasks
        .filter((candidate) => task.dependencies.includes(candidate.id))
        .map((candidate) => ({ title: candidate.title, output: candidate.result ?? '' }))
      const messages: ProviderMessage[] = [
            {
              role: 'system',
              content: [
                `你是 Bossy 团队成员 ${agent.name}（${agent.title}）。`,
                agent.instructions,
                `交付契约：${agent.outputContract}`,
                '完成当前任务，不要扩展权限。成果必须可交接，并明确列出产物、结论和未解决问题。'
              ].join('\n')
            },
            {
              role: 'user',
              content: [
                `团队总目标：${latest.objective}`,
                `当前任务：${task.title}`,
                `任务目标：${task.objective}`,
                `验收标准：${task.acceptanceCriteria}`,
                `预期产物：${task.expectedOutput}`,
                `工作目录：${latest.workspacePath || '未提供'}`,
                `输入附件：${JSON.stringify(latest.attachments)}`,
                `上游交接：${JSON.stringify(dependencyContext)}`
              ].join('\n\n')
            }
          ]
      const toolDefinitions = this.tools.definitions(agent.tools)
      const totalUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      let totalCost = 0
      let generated: AgentGeneration | undefined
      let usedFallback = false
      for (let round = 0; round < 8; round += 1) {
        const pendingMessages = this.pendingMessages(runId, agent.id)
        if (pendingMessages.length) messages.push({ role: 'user', content: `老板在运行中补充：\n${pendingMessages.map((message) => message.content).join('\n')}` })
        let roundOutput = ''
        generated = await this.generateForAgent(
          agent,
          {
            model: agent.model.modelId,
            messages,
            temperature: agent.model.temperature,
            maxOutputTokens: 8192,
            tools: toolDefinitions
          },
          controller.signal,
          (delta) => {
            roundOutput += delta
            output = roundOutput
            const now = Date.now()
            if (now - lastFlush > 350) {
              lastFlush = now
              this.updateLiveOutput(runId, taskId, output)
            }
          }
        )
        output = generated.text
        usedFallback ||= generated.usedFallback
        totalUsage.inputTokens += generated.usage.inputTokens
        totalUsage.outputTokens += generated.usage.outputTokens
        totalUsage.totalTokens += generated.usage.totalTokens
        totalCost += this.estimateCost(generated.providerId, generated.model, generated.usage)
        this.markMessagesDelivered(runId, pendingMessages.map((message) => message.id))
        const arrivedDuringStep = this.pendingMessages(runId, agent.id)
        if (generated.toolCalls.length === 0 && arrivedDuringStep.length === 0) break
        if (generated.toolCalls.length === 0) {
          messages.push({ role: 'assistant', content: generated.text })
          continue
        }

        const toolResults: Array<{ name: string; result: string }> = []
        for (const call of generated.toolCalls) {
          if (!this.tools.isAuthorized(agent.tools, call.name)) throw new Error(`Agent 未获授权使用工具 ${call.name}`)
          let requirement = this.tools.approval(call.name, call.arguments)
          if (!requirement && this.database.snapshot().settings.approvalPolicy === 'all-tools') {
            requirement = { risk: call.name === 'fetch_url' ? 'network' : 'read', summary: `调用工具 ${call.name}` }
          }
          const fingerprint = this.tools.fingerprint(taskId, call.name, call.arguments)
          const latestRun = this.database.getRun(runId)!
          const existing = latestRun.approvals.find((item) => item.fingerprint === fingerprint)
          if (requirement && !existing) {
            latestRun.approvals.push({
              id: randomUUID(),
              fingerprint,
              runId,
              taskId,
              agentId: agent.id,
              toolName: call.name,
              arguments: call.arguments,
              summary: requirement.summary,
              risk: requirement.risk,
              status: 'pending',
              createdAt: new Date().toISOString()
            })
            const blockedTask = latestRun.tasks.find((item) => item.id === taskId)
            if (blockedTask) blockedTask.status = 'blocked'
            latestRun.status = 'paused'
            latestRun.events.unshift(this.event(latestRun, 'approval', '等待风险操作批准', requirement.summary, agent.id, taskId))
            this.database.saveRun(latestRun)
            this.broadcast()
            throw new ApprovalPendingError()
          }
          if (existing?.status === 'pending') throw new ApprovalPendingError()
          if (existing?.status === 'rejected') throw new Error(`用户拒绝了工具操作：${existing.summary}`)
          const result = await this.tools.execute(call.name, call.arguments, { workspacePath: latest.workspacePath, signal: controller.signal })
          toolResults.push({ name: call.name, result })
          const eventRun = this.database.getRun(runId)!
          eventRun.events.unshift(this.event(eventRun, 'tool', `已执行 ${call.name}`, summarize(result), agent.id, taskId))
          if (call.name === 'write_file' && typeof call.arguments.path === 'string' && typeof call.arguments.content === 'string') {
            const artifactPath = resolve(latest.workspacePath, call.arguments.path)
            eventRun.artifacts.push({
              id: randomUUID(),
              runId,
              taskId,
              agentId: agent.id,
              path: artifactPath,
              type: mimeType(artifactPath),
              sha256: createHash('sha256').update(call.arguments.content).digest('hex'),
              createdAt: new Date().toISOString()
            })
          }
          this.database.saveRun(eventRun)
          this.broadcast()
        }
        messages.push({ role: 'assistant', content: generated.text || '我需要调用已授权工具继续任务。' })
        messages.push({ role: 'user', content: `工具执行结果：${JSON.stringify(toolResults)}\n请根据结果继续当前任务；如已完成，请直接提交最终成果。` })
      }
      if (!generated || generated.toolCalls.length > 0) throw new Error('Agent 工具调用轮次超过上限')
      run = this.database.getRun(runId)
      const approvalPause = run?.status === 'paused' && run.approvals.some((item) => item.status === 'pending')
      if (!run || (run.status !== 'running' && !approvalPause)) return
      const completedTask = run.tasks.find((item) => item.id === taskId)
      if (!completedTask) return
      completedTask.status = 'completed'
      completedTask.progress = 100
      completedTask.result = generated.text
      completedTask.providerId = generated.providerId
      completedTask.modelId = generated.model
      completedTask.usedFallback = usedFallback
      run.usedTokens += totalUsage.totalTokens
      run.estimatedCost += totalCost
      run.agentCosts[agent.id] = (run.agentCosts[agent.id] ?? 0) + totalCost
      if (usedFallback) {
        run.events.unshift(this.event(run, 'status', '已切换备用模型', `${agent.name} 的主模型暂时不可用，本次使用 ${generated.model}。`, agent.id, taskId))
      }
      run.events.unshift(this.event(run, 'artifact', `${task.title} 已完成`, summarize(generated.text), agent.id, taskId))
      run.events.unshift(this.event(run, 'usage', `${agent.name} 用量`, `${totalUsage.inputTokens} 输入 + ${totalUsage.outputTokens} 输出 tokens`, agent.id, taskId))
      const budgetHit = run.budget !== undefined && run.estimatedCost >= run.budget
      const agentBudgetHit = agent.budgetLimit !== undefined && run.agentCosts[agent.id] >= agent.budgetLimit
      if ((budgetHit || agentBudgetHit) && run.status === 'running') {
        run.status = 'paused'
        run.events.unshift(this.event(run, 'status', '费用额度已触达', budgetHit ? '任务总费用达到上限，已自动暂停。' : `${agent.name} 达到单 Agent 费用上限，已自动暂停。`, agent.id, taskId))
      }
      this.database.saveRun(run)
      this.broadcast()
    } catch (error) {
      run = this.database.getRun(runId)
      if (!run) return
      const interruptedTask = run.tasks.find((item) => item.id === taskId)
      if (!interruptedTask) return
      if (error instanceof ApprovalPendingError) return
      if (interruptedTask.status === 'queued' && isAbortError(error)) return
      if (run.status === 'paused') {
        interruptedTask.status = 'queued'
        interruptedTask.progress = 0
        interruptedTask.result = output
        run.events.unshift(this.event(run, 'status', `${task.title} 已中断`, '当前尝试已取消，恢复任务后会重新执行。', agent.id, taskId))
        this.database.saveRun(run)
        this.broadcast()
        return
      }
      if (run.status === 'cancelled') return
      this.failTask(run, taskId, error instanceof Error ? error.message : '模型调用失败')
    } finally {
      runControllers.delete(controller)
      this.taskControllers.delete(taskKey(runId, taskId))
    }
  }

  private async generateForAgent(
    agent: AgentDefinition,
    request: ProviderGenerateRequest,
    cancellation?: AbortSignal,
    onTextDelta?: (delta: string) => void,
    timeoutMs = 120_000
  ): Promise<AgentGeneration> {
    const primary = async (): Promise<AgentGeneration> => ({
      ...(await this.providers.generate(agent.model.connectionId, request, {
        signal: requestSignal(cancellation, timeoutMs),
        onTextDelta
      })),
      providerId: agent.model.connectionId,
      usedFallback: false
    })
    try {
      return await primary()
    } catch (error) {
      if (cancellation?.aborted || !isRetryable(error) || !agent.model.fallbackConnectionId || !agent.model.fallbackModelId) throw error
      return {
        ...(await this.providers.generate(
          agent.model.fallbackConnectionId,
          { ...request, model: agent.model.fallbackModelId },
          { signal: requestSignal(cancellation, timeoutMs), onTextDelta }
        )),
        providerId: agent.model.fallbackConnectionId,
        usedFallback: true
      }
    }
  }

  private updateLiveOutput(runId: string, taskId: string, output: string): void {
    const run = this.database.getRun(runId)
    if (!run || run.status !== 'running') return
    const task = run.tasks.find((item) => item.id === taskId)
    if (!task || task.status !== 'running') return
    task.result = output
    task.progress = Math.min(85, 10 + Math.floor(output.length / 80))
    this.database.saveRun(run)
    this.broadcast()
  }

  private failTask(run: ExecutionRun, taskId: string, detail: string): void {
    const task = run.tasks.find((item) => item.id === taskId)
    if (!task) return
    task.status = 'failed'
    task.progress = 0
    run.events.unshift(this.event(run, 'status', `${task.title} 执行失败`, detail.slice(0, 500), task.assigneeId, task.id))
    this.database.saveRun(run)
    this.broadcast()
  }

  private completeRun(run: ExecutionRun): void {
    run.status = 'completed'
    run.events.unshift(this.event(run, 'status', '任务已完成', '所有计划任务均已完成，最终产物可以在任务详情中查看。'))
    this.database.saveRun(run)
    this.broadcast()
  }

  private failRun(run: ExecutionRun, detail: string): void {
    run.status = 'failed'
    run.events.unshift(this.event(run, 'status', '任务执行已停止', detail))
    this.database.saveRun(run)
    this.broadcast()
  }

  private assertAgentModel(agent: AgentDefinition): void {
    if (!agent.model.connectionId || !agent.model.modelId.trim()) throw new Error(`${agent.name} 尚未选择可用模型`)
  }

  private estimateCost(providerId: string, modelId: string, usage: ProviderUsage): number {
    const price = this.database.snapshot().settings.pricing.find((item) => item.providerId === providerId && item.modelId === modelId)
    if (!price) return 0
    return usage.inputTokens / 1_000_000 * price.inputPerMillion + usage.outputTokens / 1_000_000 * price.outputPerMillion
  }

  private pendingMessages(runId: string, agentId: string): RunMessage[] {
    return this.database.getRun(runId)?.messages.filter((message) => message.agentId === agentId && message.status === 'pending') ?? []
  }

  private markMessagesDelivered(runId: string, messageIds: string[]): void {
    if (messageIds.length === 0) return
    const run = this.database.getRun(runId)
    if (!run) return
    const deliveredAt = new Date().toISOString()
    for (const message of run.messages) {
      if (messageIds.includes(message.id)) {
        message.status = 'delivered'
        message.deliveredAt = deliveredAt
      }
    }
    this.database.saveRun(run)
    this.broadcast()
  }

  private abortRun(runId: string): void {
    for (const controller of this.controllers.get(runId) ?? []) controller.abort()
  }

  private event(
    run: ExecutionRun,
    type: RunEvent['type'],
    title: string,
    detail: string,
    agentId?: string,
    taskId?: string
  ): RunEvent {
    return { id: randomUUID(), runId: run.id, type, title, detail, agentId, taskId, createdAt: new Date().toISOString() }
  }

  private broadcast(): void {
    this.getWindow()?.webContents.send('snapshot:changed', this.database.snapshot())
  }
}

class ApprovalPendingError extends Error {}

function requestSignal(cancellation?: AbortSignal, timeoutMs = 120_000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return cancellation ? AbortSignal.any([cancellation, timeout]) : timeout
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return error.retryable
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
}

function taskKey(runId: string, taskId: string): string {
  return `${runId}:${taskId}`
}

function summarize(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > 600 ? `${normalized.slice(0, 600)}...` : normalized
}

function planningError(error: unknown, chiefName: string): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `${chiefName} 的模型在 60 秒内没有完成规划。请测试模型连接、换用更快的模型，或稍后重试。`
  }
  const message = error instanceof Error ? error.message : '未知错误'
  return `${chiefName} 无法生成执行计划：${message}`
}

function validationSummary(error: unknown): string {
  if (error instanceof Error) {
    try {
      const issues = JSON.parse(error.message) as Array<{ path?: Array<string | number>; message?: string }>
      if (Array.isArray(issues)) return issues.slice(0, 3).map((issue) => `${issue.path?.join('.') || '计划'}: ${issue.message || '格式错误'}`).join('；')
    } catch {
      return error.message.slice(0, 300)
    }
  }
  return '计划 JSON 格式错误'
}

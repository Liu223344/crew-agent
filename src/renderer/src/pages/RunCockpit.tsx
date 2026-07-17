import { useMemo, useState } from 'react'
import { Check, CircleDollarSign, Clock3, FolderOpen, MessageSquareText, Pause, Play, Plus, Square, Zap } from 'lucide-react'
import type { AgentStatus, CreateRunInput, ExecutionRun, PlanTask } from '@shared/contracts'
import { AgentTree } from '../components/AgentTree'
import { PageHeader } from '../components/PageHeader'
import { useAppStore } from '../store'

export function RunCockpit(): React.JSX.Element {
  const { snapshot, selectedRunId, selectRun, selectedTeamId, createRun, approveRun, setRunStatus } = useAppStore()
  const [composerOpen, setComposerOpen] = useState(snapshot!.runs.length === 0)
  const selectedRun = snapshot!.runs.find((run) => run.id === selectedRunId) ?? snapshot!.runs[0]
  const team = snapshot!.teams.find((item) => item.id === selectedRun?.teamId)

  return (
    <div className="page runs-page">
      <PageHeader
        eyebrow="MISSION CONTROL"
        title="任务驾驶舱"
        description="批准计划、观察团队运行，并在需要时介入。"
        actions={<button className="button primary" onClick={() => setComposerOpen(true)}><Plus size={16} />新任务</button>}
      />

      {composerOpen && <TaskComposer defaultTeamId={selectedTeamId ?? snapshot!.teams[0].id} onClose={() => setComposerOpen(false)} onCreate={createRun} />}

      <div className="run-layout">
        <aside className="run-list">
          <div className="run-list-title"><span>任务记录</span><b>{snapshot!.runs.length}</b></div>
          {snapshot!.runs.map((run) => (
            <button key={run.id} className={run.id === selectedRun?.id ? 'active' : ''} onClick={() => selectRun(run.id)}>
              <i className={`run-dot ${run.status}`} />
              <div><strong>{run.title}</strong><span>{run.tasks.filter((task) => task.status === 'completed').length}/{run.tasks.length} · {run.usedTokens.toLocaleString()} tokens</span></div>
              <time>{new Date(run.updatedAt).toLocaleDateString()}</time>
            </button>
          ))}
          {snapshot!.runs.length === 0 && <div className="empty-compact"><Zap size={24} /><span>还没有执行记录</span></div>}
        </aside>

        {!selectedRun || !team ? (
          <section className="run-empty"><Zap size={38} /><h2>向团队下达一个目标</h2><p>Bossy 会先生成任务计划，得到你的批准后再开始执行。</p><button className="button primary" onClick={() => setComposerOpen(true)}><Plus size={16} />创建任务</button></section>
        ) : selectedRun.status === 'awaiting_approval' ? (
          <PlanApproval run={selectedRun} teamName={team.name} onApprove={() => void approveRun(selectedRun.id)} />
        ) : (
          <section className="cockpit">
            <div className="cockpit-toolbar">
              <div className="run-title"><span className={`run-dot ${selectedRun.status}`} /><div><strong>{selectedRun.title}</strong><span>{runStatusText(selectedRun.status)}</span></div></div>
              <div className="run-metrics"><span><Clock3 size={14} />{selectedRun.tasks.filter((task) => task.status === 'completed').length}/{selectedRun.tasks.length} 任务</span><span><Zap size={14} />{selectedRun.usedTokens.toLocaleString()} tokens</span><span><CircleDollarSign size={14} />¥{selectedRun.estimatedCost.toFixed(2)}</span></div>
              <div className="run-controls">
                {selectedRun.status === 'running' && <button className="icon-button" title="暂停" onClick={() => void setRunStatus(selectedRun.id, 'paused')}><Pause size={16} /></button>}
                {selectedRun.status === 'paused' && <button className="icon-button" title="继续" onClick={() => void setRunStatus(selectedRun.id, 'running')}><Play size={16} /></button>}
                {!['completed', 'cancelled'].includes(selectedRun.status) && <button className="icon-button danger" title="停止" onClick={() => void setRunStatus(selectedRun.id, 'cancelled')}><Square size={15} /></button>}
              </div>
            </div>
            <div className="cockpit-main">
              <div className="execution-tree"><AgentTree team={team} {...deriveAgentActivity(selectedRun, team.chiefAgentId)} /></div>
              <aside className="timeline-panel">
                <div className="panel-heading"><div><span className="section-label">LIVE TIMELINE</span><h2>执行动态</h2></div><span className="live-indicator"><i />实时</span></div>
                <div className="timeline">
                  {selectedRun.events.map((event) => {
                    const agent = team.agents.find((item) => item.id === event.agentId)
                    return <div className="timeline-event" key={event.id}><i className={`event-${event.type}`} /><div><span>{agent?.name ?? 'Bossy'}</span><strong>{event.title}</strong><p>{event.detail}</p><time>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div></div>
                  })}
                </div>
                <div className="message-box"><MessageSquareText size={16} /><input placeholder="向总指挥补充说明..." /><button>发送</button></div>
              </aside>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function TaskComposer({ defaultTeamId, onClose, onCreate }: { defaultTeamId: string; onClose: () => void; onCreate: (input: CreateRunInput) => Promise<ExecutionRun> }): React.JSX.Element {
  const { snapshot } = useAppStore()
  const [form, setForm] = useState<CreateRunInput>({ teamId: defaultTeamId, objective: '', workspacePath: '', concurrency: 3 })
  const [submitting, setSubmitting] = useState(false)
  const chooseFolder = async (): Promise<void> => {
    const path = await window.bossy.openDirectory()
    if (path) setForm((value) => ({ ...value, workspacePath: path }))
  }
  const submit = async (): Promise<void> => {
    if (!form.objective.trim()) return
    setSubmitting(true)
    await onCreate(form)
    setSubmitting(false)
    onClose()
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="task-composer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="composer-heading"><div><span className="section-label">NEW MISSION</span><h2>给团队下达目标</h2><p>总指挥会先生成计划，不会立即执行。</p></div><button className="icon-button" onClick={onClose}>×</button></div>
        <label>使用团队<select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>{snapshot!.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label>任务目标<textarea autoFocus rows={6} placeholder="例如：研究三款同类产品，整理差异，并在工作目录中生成一份完整的产品分析报告。" value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} /></label>
        <label>工作目录<div className="path-input"><input readOnly value={form.workspacePath} placeholder="选择 Agent 可以访问的文件夹" /><button className="icon-button" title="选择文件夹" onClick={() => void chooseFolder()}><FolderOpen size={16} /></button></div></label>
        <div className="form-grid two"><label>最大并发<input type="number" min={1} max={8} value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: Number(event.target.value) })} /></label><label>费用上限（可选）<input type="number" min={0} placeholder="CNY" onChange={(event) => setForm({ ...form, budget: event.target.value ? Number(event.target.value) : undefined })} /></label></div>
        <div className="composer-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={!form.objective.trim() || submitting} onClick={() => void submit()}><Zap size={16} />{submitting ? '正在规划...' : '生成执行计划'}</button></div>
      </section>
    </div>
  )
}

function PlanApproval({ run, teamName, onApprove }: { run: ExecutionRun; teamName: string; onApprove: () => void }): React.JSX.Element {
  return (
    <section className="plan-approval">
      <div className="approval-head"><div><span className="section-label">PLAN V{run.planVersion}</span><h2>{run.title}</h2><p>{run.objective}</p></div><div className="approval-summary"><span>{teamName}</span><strong>{run.tasks.length} 个任务</strong><small>并发上限 {run.concurrency}</small></div></div>
      <div className="plan-table">
        <div className="plan-table-head"><span>任务</span><span>交付物</span><span>依赖</span></div>
        {run.tasks.map((task, index) => <div className="plan-row" key={task.id}><b>{String(index + 1).padStart(2, '0')}</b><div><strong>{task.title}</strong><p>{task.objective}</p></div><span>{task.expectedOutput}</span><span>{task.dependencies.length ? `${task.dependencies.length} 项` : '无'}</span></div>)}
      </div>
      <div className="approval-foot"><div><Check size={17} /><span>批准后，团队将在选定工作区内开始执行。</span></div><button className="button primary" onClick={onApprove}><Play size={16} />批准并开始</button></div>
    </section>
  )
}

function deriveAgentActivity(run: ExecutionRun, chiefId: string): { statuses: Record<string, AgentStatus>; tasks: Record<string, { title: string; progress: number }> } {
  const statuses: Record<string, AgentStatus> = {}
  const tasks: Record<string, { title: string; progress: number }> = {}
  const byAgent = new Map<string, PlanTask[]>()
  for (const task of run.tasks) byAgent.set(task.assigneeId, [...(byAgent.get(task.assigneeId) ?? []), task])
  for (const [agentId, agentTasks] of byAgent) {
    const active = agentTasks.find((task) => task.status === 'running') ?? agentTasks.find((task) => task.status === 'queued') ?? agentTasks.at(-1)!
    tasks[agentId] = { title: active.title, progress: active.progress }
    statuses[agentId] = active.status === 'running' ? 'running' : active.status === 'failed' ? 'failed' : agentTasks.every((task) => task.status === 'completed') ? 'completed' : run.status === 'paused' ? 'waiting' : 'queued'
  }
  if (run.status === 'completed') statuses[chiefId] = 'completed'
  return { statuses, tasks }
}

function runStatusText(status: ExecutionRun['status']): string {
  return ({ draft: '草稿', awaiting_approval: '等待批准', running: '团队正在工作', paused: '已暂停', completed: '已完成', failed: '执行失败', cancelled: '已停止' } as const)[status]
}


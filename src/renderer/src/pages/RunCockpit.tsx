import { useEffect, useMemo, useState } from 'react'
import { Check, CircleDollarSign, Clock3, FileCheck2, FolderOpen, MessageSquareText, Paperclip, Pause, Pencil, Play, Plus, Save, ShieldAlert, Square, X, Zap } from 'lucide-react'
import type { AgentStatus, CreateRunInput, ExecutionRun, PlanTask, UpdateRunTaskInput } from '@shared/contracts'
import { AgentTree } from '../components/AgentTree'
import { PageHeader } from '../components/PageHeader'
import { useAppStore } from '../store'
import { useLocale } from '../i18n'

export function RunCockpit(): React.JSX.Element {
  const { snapshot, selectedRunId, selectRun, selectedTeamId, createRun, approveRun, setRunStatus, resolveApproval, sendRunMessage, updateRunTask } = useAppStore()
  const { t, language } = useLocale()
  const [composerOpen, setComposerOpen] = useState(snapshot!.runs.length === 0)
  const selectedRun = snapshot!.runs.find((run) => run.id === selectedRunId) ?? snapshot!.runs[0]
  const team = snapshot!.teams.find((item) => item.id === selectedRun?.teamId)

  return (
    <div className="page runs-page">
      <PageHeader
        eyebrow="MISSION CONTROL"
        title={t('任务驾驶舱', 'Mission control')}
        description={t('批准计划、观察团队运行，并在需要时介入。', 'Approve plans, watch your team work, and intervene when needed.')}
        actions={<button className="button primary" onClick={() => setComposerOpen(true)}><Plus size={16} />{t('新任务', 'New mission')}</button>}
      />

      {composerOpen && <TaskComposer defaultTeamId={selectedTeamId ?? snapshot!.teams[0].id} onClose={() => setComposerOpen(false)} onCreate={createRun} />}

      <div className="run-layout">
        <aside className="run-list">
          <div className="run-list-title"><span>{t('任务记录', 'Mission history')}</span><b>{snapshot!.runs.length}</b></div>
          {snapshot!.runs.map((run) => (
            <button key={run.id} className={run.id === selectedRun?.id ? 'active' : ''} onClick={() => selectRun(run.id)}>
              <i className={`run-dot ${run.status}`} />
              <div><strong>{run.title}</strong><span>{run.tasks.filter((task) => task.status === 'completed').length}/{run.tasks.length} · {run.usedTokens.toLocaleString()} tokens</span></div>
              <time>{new Date(run.updatedAt).toLocaleDateString()}</time>
            </button>
          ))}
          {snapshot!.runs.length === 0 && <div className="empty-compact"><Zap size={24} /><span>{t('还没有执行记录', 'No runs yet')}</span></div>}
        </aside>

        {!selectedRun || !team ? (
          <section className="run-empty"><Zap size={38} /><h2>{t('向团队下达一个目标', 'Give your team a goal')}</h2><p>{t('Bossy 会先生成任务计划，得到你的批准后再开始执行。', 'Bossy generates a plan first and starts only after your approval.')}</p><button className="button primary" onClick={() => setComposerOpen(true)}><Plus size={16} />{t('创建任务', 'Create mission')}</button></section>
        ) : selectedRun.status === 'awaiting_approval' ? (
          <PlanApproval run={selectedRun} teamName={team.name} onApprove={() => void approveRun(selectedRun.id)} />
        ) : (
          <section className="cockpit">
            <div className="cockpit-toolbar">
              <div className="run-title"><span className={`run-dot ${selectedRun.status}`} /><div><strong>{selectedRun.title}</strong><span>{runStatusText(selectedRun.status, language)}</span></div></div>
              <div className="run-metrics"><span><Clock3 size={14} />{selectedRun.tasks.filter((task) => task.status === 'completed').length}/{selectedRun.tasks.length} {t('任务', 'tasks')}</span><span><Zap size={14} />{selectedRun.usedTokens.toLocaleString()} tokens</span><span><CircleDollarSign size={14} />{snapshot!.settings.currency === 'CNY' ? '¥' : '$'}{selectedRun.estimatedCost.toFixed(2)}</span></div>
              <div className="run-controls">
                {selectedRun.status === 'running' && <button className="icon-button" title={t('暂停', 'Pause')} onClick={() => void setRunStatus(selectedRun.id, 'paused')}><Pause size={16} /></button>}
                {selectedRun.status === 'paused' && <button className="icon-button" title={t('继续', 'Resume')} onClick={() => void setRunStatus(selectedRun.id, 'running')}><Play size={16} /></button>}
                {!['completed', 'cancelled'].includes(selectedRun.status) && <button className="icon-button danger" title={t('停止', 'Stop')} onClick={() => void setRunStatus(selectedRun.id, 'cancelled')}><Square size={15} /></button>}
              </div>
            </div>
            <div className="cockpit-main">
              <div className="execution-tree"><AgentTree team={team} {...deriveAgentActivity(selectedRun, team.chiefAgentId)} /></div>
              <aside className="timeline-panel">
                <div className="panel-heading"><div><span className="section-label">LIVE TIMELINE</span><h2>{t('执行动态', 'Activity')}</h2></div><span className="live-indicator"><i />{t('实时', 'Live')}</span></div>
                <TaskEditor run={selectedRun} agents={team.agents.map((agent) => ({ id: agent.id, name: agent.name }))} onSave={(taskId, patch) => updateRunTask(selectedRun.id, taskId, patch)} />
                <ApprovalPanel run={selectedRun} onResolve={(approvalId, decision) => void resolveApproval(selectedRun.id, approvalId, decision)} />
                <TaskOutputPanel run={selectedRun} agentNames={Object.fromEntries(team.agents.map((agent) => [agent.id, agent.name]))} />
                <ArtifactPanel run={selectedRun} />
                <div className="timeline">
                  {selectedRun.events.map((event) => {
                    const agent = team.agents.find((item) => item.id === event.agentId)
                    return <div className="timeline-event" key={event.id}><i className={`event-${event.type}`} /><div><span>{agent?.name ?? 'Bossy'}</span><strong>{event.title}</strong><p>{event.detail}</p><time>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div></div>
                  })}
                </div>
                <MessageComposer agents={team.agents.map((agent) => ({ id: agent.id, name: agent.name }))} chiefId={team.chiefAgentId} onSend={(agentId, content) => sendRunMessage(selectedRun.id, agentId, content)} />
              </aside>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function TaskEditor({ run, agents, onSave }: { run: ExecutionRun; agents: Array<{ id: string; name: string }>; onSave: (taskId: string, patch: UpdateRunTaskInput) => Promise<void> }): React.JSX.Element | null {
  const { t } = useLocale()
  const editable = run.tasks.filter((task) => task.status === 'queued' || task.status === 'running' || task.status === 'blocked')
  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState(editable[0]?.id ?? '')
  const task = editable.find((item) => item.id === taskId) ?? editable[0]
  const [draft, setDraft] = useState<UpdateRunTaskInput | null>(task ? taskPatch(task) : null)
  useEffect(() => { if (task) setDraft(taskPatch(task)) }, [task?.id])
  if (editable.length === 0) return null
  if (!open) return <button className="edit-task-trigger" onClick={() => setOpen(true)}><Pencil size={13} />{t('修改或改派待办任务', 'Edit or reassign pending tasks')}</button>
  if (!task || !draft) return null
  return <div className="task-editor"><div><strong>{t('修改执行任务', 'Edit task')}</strong><button className="icon-button" title={t('关闭', 'Close')} onClick={() => setOpen(false)}><X size={13} /></button></div><select value={task.id} onChange={(event) => setTaskId(event.target.value)}>{editable.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><textarea rows={3} value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} /><select value={draft.assigneeId} onChange={(event) => setDraft({ ...draft, assigneeId: event.target.value })}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button className="button primary" onClick={() => void onSave(task.id, draft).then(() => setOpen(false))}><Save size={13} />{t('保存并应用', 'Save and apply')}</button></div>
}

function taskPatch(task: PlanTask): UpdateRunTaskInput {
  return { title: task.title, objective: task.objective, assigneeId: task.assigneeId, expectedOutput: task.expectedOutput, acceptanceCriteria: task.acceptanceCriteria }
}

function MessageComposer({ agents, chiefId, onSend }: { agents: Array<{ id: string; name: string }>; chiefId: string; onSend: (agentId: string, content: string) => Promise<void> }): React.JSX.Element {
  const { t } = useLocale()
  const [agentId, setAgentId] = useState(chiefId)
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const send = async (): Promise<void> => {
    if (!content.trim() || sending) return
    setSending(true)
    try {
      await onSend(agentId, content)
      setContent('')
    } finally {
      setSending(false)
    }
  }
  return <div className="message-box"><MessageSquareText size={16} /><select title={t('选择 Agent', 'Choose agent')} value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><input value={content} placeholder={t('补充说明...', 'Add guidance...')} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void send() }} /><button disabled={!content.trim() || sending} onClick={() => void send()}>{sending ? t('发送中', 'Sending') : t('发送', 'Send')}</button></div>
}

function ApprovalPanel({ run, onResolve }: { run: ExecutionRun; onResolve: (approvalId: string, decision: 'approved' | 'rejected') => void }): React.JSX.Element | null {
  const { t } = useLocale()
  const approval = run.approvals.find((item) => item.status === 'pending')
  if (!approval) return null
  return <div className="approval-card"><div className="approval-icon"><ShieldAlert size={18} /></div><div><span>{t('需要你的批准', 'Approval required')}</span><strong>{approval.summary}</strong><pre>{JSON.stringify(approval.arguments, null, 2)}</pre><div><button className="button secondary" onClick={() => onResolve(approval.id, 'rejected')}><X size={14} />{t('拒绝', 'Reject')}</button><button className="button primary" onClick={() => onResolve(approval.id, 'approved')}><Check size={14} />{t('批准一次', 'Approve once')}</button></div></div></div>
}

function TaskOutputPanel({ run, agentNames }: { run: ExecutionRun; agentNames: Record<string, string> }): React.JSX.Element | null {
  const { t } = useLocale()
  const task = run.tasks.find((item) => item.status === 'running') ?? [...run.tasks].reverse().find((item) => item.result)
  if (!task?.result) return null
  return <div className={`task-output ${task.status}`}><div><span>{agentNames[task.assigneeId] ?? 'Agent'}</span><strong>{task.title}</strong><b>{task.status === 'running' ? `${task.progress}%` : t('已完成', 'Completed')}</b></div><pre>{task.result}</pre></div>
}

function ArtifactPanel({ run }: { run: ExecutionRun }): React.JSX.Element | null {
  const { t } = useLocale()
  if (run.artifacts.length === 0) return null
  return <div className="artifact-panel"><strong><FileCheck2 size={13} />{t('产物文件', 'Artifacts')}</strong>{run.artifacts.slice(-5).reverse().map((artifact) => <div key={artifact.id}><span>{artifact.path.split('/').at(-1)}</span><small>{artifact.type} · {artifact.sha256.slice(0, 10)}</small></div>)}</div>
}

function TaskComposer({ defaultTeamId, onClose, onCreate }: { defaultTeamId: string; onClose: () => void; onCreate: (input: CreateRunInput) => Promise<ExecutionRun> }): React.JSX.Element {
  const { snapshot } = useAppStore()
  const { t } = useLocale()
  const [form, setForm] = useState<CreateRunInput>({ teamId: defaultTeamId, objective: '', workspacePath: '', concurrency: 3 })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const chooseAttachments = async (): Promise<void> => {
    const paths = await window.bossy.openAttachments()
    if (paths.length) setForm((value) => ({ ...value, attachmentPaths: [...(value.attachmentPaths ?? []), ...paths].slice(0, 20) }))
  }
  const chooseFolder = async (): Promise<void> => {
    const path = await window.bossy.openDirectory()
    if (path) setForm((value) => ({ ...value, workspacePath: path }))
  }
  const submit = async (): Promise<void> => {
    if (!form.objective.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await onCreate(form)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '总指挥暂时无法生成计划')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="task-composer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="composer-heading"><div><span className="section-label">NEW MISSION</span><h2>{t('给团队下达目标', 'Give your team a goal')}</h2><p>{t('总指挥会先生成计划，不会立即执行。', 'The chief creates a plan first and will not execute immediately.')}</p></div><button className="icon-button" onClick={onClose}>×</button></div>
        <label>{t('使用团队', 'Team')}<select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>{snapshot!.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label>{t('任务目标', 'Goal')}<textarea autoFocus rows={6} placeholder={t('例如：研究三款同类产品，整理差异，并在工作目录中生成一份完整的产品分析报告。', 'Example: Compare three competing products and create a complete analysis report in the workspace.')} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} /></label>
        <label>{t('工作目录', 'Workspace')}<div className="path-input"><input readOnly value={form.workspacePath} placeholder={t('选择 Agent 可以访问的文件夹', 'Choose the folder agents can access')} /><button className="icon-button" title={t('选择文件夹', 'Choose folder')} onClick={() => void chooseFolder()}><FolderOpen size={16} /></button></div></label>
        <div className="attachment-picker"><button className="button secondary" onClick={() => void chooseAttachments()}><Paperclip size={15} />{t('添加附件', 'Add attachments')}</button><span>{(form.attachmentPaths ?? []).length ? `${form.attachmentPaths!.length} ${t('个文件', 'files')}` : t('未添加附件', 'No attachments')}</span></div>
        {(form.attachmentPaths ?? []).length > 0 && <div className="attachment-list">{form.attachmentPaths!.map((path) => <div key={path}><span>{path.split('/').at(-1)}</span><button title={t('移除', 'Remove')} onClick={() => setForm({ ...form, attachmentPaths: form.attachmentPaths?.filter((item) => item !== path) })}><X size={12} /></button></div>)}</div>}
        <div className="form-grid two"><label>{t('最大并发', 'Max concurrency')}<input type="number" min={1} max={8} value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: Number(event.target.value) })} /></label><label>{t('费用上限（可选）', 'Budget limit (optional)')}<input type="number" min={0} placeholder={snapshot!.settings.currency} onChange={(event) => setForm({ ...form, budget: event.target.value ? Number(event.target.value) : undefined })} /></label></div>
        {error && <div className="composer-error"><span>{error}</span></div>}
        <div className="composer-actions"><button className="button secondary" onClick={onClose}>{t('取消', 'Cancel')}</button><button className="button primary" disabled={!form.objective.trim() || submitting} onClick={() => void submit()}><Zap size={16} />{submitting ? t('正在规划...', 'Planning...') : t('生成执行计划', 'Generate plan')}</button></div>
      </section>
    </div>
  )
}

function PlanApproval({ run, teamName, onApprove }: { run: ExecutionRun; teamName: string; onApprove: () => void }): React.JSX.Element {
  const { t } = useLocale()
  return (
    <section className="plan-approval">
      <div className="approval-head"><div><span className="section-label">PLAN V{run.planVersion}</span><h2>{run.title}</h2><p>{run.objective}</p></div><div className="approval-summary"><span>{teamName}</span><strong>{run.tasks.length} {t('个任务', 'tasks')}</strong><small>{t('并发上限', 'Concurrency')} {run.concurrency} · {run.attachments.length} {t('个附件', 'attachments')}</small></div></div>
      <div className="plan-table">
        <div className="plan-table-head"><span>{t('任务', 'Task')}</span><span>{t('交付物', 'Output')}</span><span>{t('依赖', 'Deps')}</span></div>
        {run.tasks.map((task, index) => <div className="plan-row" key={task.id}><b>{String(index + 1).padStart(2, '0')}</b><div><strong>{task.title}</strong><p>{task.objective}</p></div><span>{task.expectedOutput}</span><span>{task.dependencies.length ? `${task.dependencies.length}` : t('无', 'None')}</span></div>)}
      </div>
      <div className="approval-foot"><div><Check size={17} /><span>{t('批准后，团队将在选定工作区内开始执行。', 'After approval, the team will start inside the selected workspace.')}</span></div><button className="button primary" onClick={onApprove}><Play size={16} />{t('批准并开始', 'Approve and start')}</button></div>
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

function runStatusText(status: ExecutionRun['status'], language: 'zh-CN' | 'en'): string {
  const labels = language === 'en'
    ? ({ draft: 'Draft', awaiting_approval: 'Awaiting approval', running: 'Team is working', paused: 'Paused', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped' } as const)
    : ({ draft: '草稿', awaiting_approval: '等待批准', running: '团队正在工作', paused: '已暂停', completed: '已完成', failed: '执行失败', cancelled: '已停止' } as const)
  return labels[status]
}

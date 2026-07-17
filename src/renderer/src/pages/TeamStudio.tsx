import { useEffect, useMemo, useState } from 'react'
import { Copy, Plus, Save, Trash2, UserRoundPlus } from 'lucide-react'
import type { AgentDefinition, AgentRole, TeamDefinition } from '@shared/contracts'
import { roleLabels, statusLabels } from '@shared/contracts'
import { AgentTree } from '../components/AgentTree'
import { PageHeader } from '../components/PageHeader'
import { useAppStore } from '../store'

const roleColors: Record<AgentRole, string> = {
  chief: '#285D50',
  research: '#3568A8',
  writer: '#8B5E9D',
  designer: '#B45273',
  developer: '#347B65',
  reviewer: '#9B6A27',
  custom: '#667085'
}

export function TeamStudio(): React.JSX.Element {
  const { snapshot, selectedTeamId, selectedAgentId, selectAgent, saveTeam, createTeam, deleteTeam } = useAppStore()
  const sourceTeam = snapshot!.teams.find((team) => team.id === selectedTeamId) ?? snapshot!.teams[0]
  const [draft, setDraft] = useState<TeamDefinition>(sourceTeam)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    setDraft(sourceTeam)
    setSaved(true)
  }, [sourceTeam])

  const selectedAgent = useMemo(
    () => draft.agents.find((agent) => agent.id === selectedAgentId) ?? draft.agents.find((agent) => agent.id === draft.chiefAgentId),
    [draft, selectedAgentId]
  )

  const updateTeam = (patch: Partial<TeamDefinition>): void => {
    setDraft((team) => ({ ...team, ...patch }))
    setSaved(false)
  }
  const updateAgent = (patch: Partial<AgentDefinition>): void => {
    if (!selectedAgent) return
    updateTeam({ agents: draft.agents.map((agent) => agent.id === selectedAgent.id ? { ...agent, ...patch } : agent) })
  }
  const addAgent = (): void => {
    const id = crypto.randomUUID()
    const agent: AgentDefinition = {
      id,
      name: `新成员 ${draft.agents.length}`,
      role: 'custom',
      title: 'AI Specialist',
      instructions: '根据总指挥分配的目标完成专业工作，并提交可验证的成果。',
      color: roleColors.custom,
      model: { connectionId: 'openai', modelId: '', temperature: 0.4 },
      tools: [],
      outputContract: '提交结构化成果、文件位置和交接说明。'
    }
    updateTeam({ agents: [...draft.agents, agent] })
    selectAgent(id)
  }
  const removeAgent = (): void => {
    if (!selectedAgent || selectedAgent.id === draft.chiefAgentId) return
    updateTeam({ agents: draft.agents.filter((agent) => agent.id !== selectedAgent.id) })
    selectAgent(draft.chiefAgentId)
  }
  const duplicateTeam = async (): Promise<void> => {
    const now = new Date().toISOString()
    const idMap = new Map(draft.agents.map((agent) => [agent.id, crypto.randomUUID()]))
    await saveTeam({
      ...draft,
      id: crypto.randomUUID(),
      name: `${draft.name} 副本`,
      chiefAgentId: idMap.get(draft.chiefAgentId)!,
      agents: draft.agents.map((agent) => ({ ...agent, id: idMap.get(agent.id)! })),
      createdAt: now,
      updatedAt: now
    })
  }

  return (
    <div className="page studio-page">
      <PageHeader
        eyebrow="TEAM TREE"
        title="团队树"
        description="定义谁负责指挥、谁负责执行，以及每位成员使用的模型和工具。"
        actions={
          <>
            <button className="icon-button" title="复制团队" onClick={() => void duplicateTeam()}><Copy size={16} /></button>
            <button className="button secondary" onClick={() => void createTeam()}><Plus size={16} />新建团队</button>
            <button className="button primary" disabled={saved} onClick={() => void saveTeam(draft).then(() => setSaved(true))}><Save size={16} />{saved ? '已保存' : '保存更改'}</button>
          </>
        }
      />

      <div className="studio-toolbar">
        <label>团队名称<input value={draft.name} onChange={(event) => updateTeam({ name: event.target.value })} /></label>
        <label className="grow">团队说明<input value={draft.description} onChange={(event) => updateTeam({ description: event.target.value })} /></label>
        <label>并发数<input className="number-input" type="number" min={1} max={8} value={draft.concurrency} onChange={(event) => updateTeam({ concurrency: Number(event.target.value) })} /></label>
        <button className="button secondary" onClick={addAgent}><UserRoundPlus size={16} />添加成员</button>
      </div>

      <div className="studio-workspace">
        <section className="tree-canvas">
          <AgentTree team={draft} onSelect={selectAgent} />
          <div className="status-legend">
            {(['idle', 'planning', 'running', 'waiting', 'blocked', 'failed', 'completed'] as const).map((status) => (
              <span key={status}><i className={`status-${status}`} />{statusLabels[status].zh}</span>
            ))}
          </div>
        </section>

        {selectedAgent && (
          <aside className="inspector">
            <div className="inspector-heading">
              <div className="agent-avatar large" style={{ color: selectedAgent.color, backgroundColor: `${selectedAgent.color}18` }}>{selectedAgent.name.slice(0, 1)}</div>
              <div><span className="section-label">AGENT PROFILE</span><h2>{selectedAgent.name}</h2></div>
              {selectedAgent.id !== draft.chiefAgentId && <button className="icon-button danger" title="删除成员" onClick={removeAgent}><Trash2 size={16} /></button>}
            </div>

            <div className="form-grid">
              <label>成员名称<input value={selectedAgent.name} onChange={(event) => updateAgent({ name: event.target.value })} /></label>
              <label>职位名称<input value={selectedAgent.title} onChange={(event) => updateAgent({ title: event.target.value })} /></label>
              <label>角色类型<select value={selectedAgent.role} disabled={selectedAgent.id === draft.chiefAgentId} onChange={(event) => { const role = event.target.value as AgentRole; updateAgent({ role, color: roleColors[role] }) }}>
                {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label.zh}</option>)}
              </select></label>
              <label>身份颜色<div className="color-field"><input type="color" value={selectedAgent.color} onChange={(event) => updateAgent({ color: event.target.value })} /><span>{selectedAgent.color}</span></div></label>
            </div>

            <div className="inspector-section">
              <h3>模型绑定</h3>
              <label>供应商<select value={selectedAgent.model.connectionId} onChange={(event) => updateAgent({ model: { ...selectedAgent.model, connectionId: event.target.value } })}>
                {snapshot!.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.status === 'ready' ? '' : ' · 未配置'}</option>)}
              </select></label>
              <label>模型 ID<input value={selectedAgent.model.modelId} placeholder="输入供应商提供的模型 ID" onChange={(event) => updateAgent({ model: { ...selectedAgent.model, modelId: event.target.value } })} /></label>
              <label>创造性 <span className="range-value">{selectedAgent.model.temperature.toFixed(1)}</span><input type="range" min={0} max={1} step={0.1} value={selectedAgent.model.temperature} onChange={(event) => updateAgent({ model: { ...selectedAgent.model, temperature: Number(event.target.value) } })} /></label>
            </div>

            <div className="inspector-section">
              <h3>工作指令</h3>
              <label>职责与行为<textarea rows={5} value={selectedAgent.instructions} onChange={(event) => updateAgent({ instructions: event.target.value })} /></label>
              <label>交付要求<textarea rows={3} value={selectedAgent.outputContract} onChange={(event) => updateAgent({ outputContract: event.target.value })} /></label>
            </div>
          </aside>
        )}
      </div>

      {snapshot!.teams.length > 1 && <button className="delete-team-button" onClick={() => void deleteTeam(draft.id)}><Trash2 size={14} />删除当前团队</button>}
    </div>
  )
}


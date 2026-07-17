import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, Plus, Save, Trash2, Upload, UserRoundPlus } from 'lucide-react'
import type { AgentDefinition, AgentRole, TeamDefinition } from '@shared/contracts'
import { roleLabels, statusLabels } from '@shared/contracts'
import { AgentTree } from '../components/AgentTree'
import { PageHeader } from '../components/PageHeader'
import { useAppStore } from '../store'
import { useLocale } from '../i18n'

const roleColors: Record<AgentRole, string> = {
  chief: '#285D50',
  research: '#3568A8',
  writer: '#8B5E9D',
  designer: '#B45273',
  developer: '#347B65',
  reviewer: '#9B6A27',
  custom: '#667085'
}

const builtInTools = [
  { id: 'read_file', zh: '读取文件', en: 'Read files', detailZh: '工作目录内', detailEn: 'Workspace only' },
  { id: 'list_files', zh: '浏览目录', en: 'List files', detailZh: '工作目录内', detailEn: 'Workspace only' },
  { id: 'write_file', zh: '写入文件', en: 'Write files', detailZh: '每次审批', detailEn: 'Approval required' },
  { id: 'run_command', zh: '运行命令', en: 'Run commands', detailZh: '每次审批', detailEn: 'Approval required' },
  { id: 'fetch_url', zh: '读取网页', en: 'Fetch web pages', detailZh: '仅公网', detailEn: 'Public web only' }
]

export function TeamStudio(): React.JSX.Element {
  const { snapshot, selectedTeamId, selectedAgentId, selectAgent, saveTeam, createTeam, deleteTeam, exportTeam, importTeam } = useAppStore()
  const { t, language } = useLocale()
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
  const primaryProvider = snapshot!.providers.find((provider) => provider.id === selectedAgent?.model.connectionId)
  const fallbackProvider = snapshot!.providers.find((provider) => provider.id === selectedAgent?.model.fallbackConnectionId)
  const availableTools = [
    ...builtInTools.map((tool) => ({ id: tool.id, label: language === 'en' ? tool.en : tool.zh, detail: language === 'en' ? tool.detailEn : tool.detailZh })),
    ...snapshot!.mcpServers.flatMap((server) => server.tools.map((tool) => ({ id: `mcp:${server.id}:${tool.name}`, label: tool.name, detail: `${server.name}${tool.readOnly ? t(' · 只读', ' · Read only') : t(' · 需审批', ' · Approval required')}` })))
  ]

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
        title={t('团队树', 'Team tree')}
        description={t('定义谁负责指挥、谁负责执行，以及每位成员使用的模型和工具。', 'Define who leads, who executes, and which models and tools each agent can use.')}
        actions={
          <>
            <button className="icon-button" title={t('导入团队', 'Import team')} onClick={() => void importTeam()}><Upload size={16} /></button>
            <button className="icon-button" title={t('导出团队', 'Export team')} onClick={() => void exportTeam(draft.id)}><Download size={16} /></button>
            <button className="icon-button" title={t('复制团队', 'Duplicate team')} onClick={() => void duplicateTeam()}><Copy size={16} /></button>
            <button className="button secondary" onClick={() => void createTeam()}><Plus size={16} />{t('新建团队', 'New team')}</button>
            <button className="button primary" disabled={saved} onClick={() => void saveTeam(draft).then(() => setSaved(true))}><Save size={16} />{saved ? t('已保存', 'Saved') : t('保存更改', 'Save changes')}</button>
          </>
        }
      />

      <div className="studio-toolbar">
        <label>{t('团队名称', 'Team name')}<input value={draft.name} onChange={(event) => updateTeam({ name: event.target.value })} /></label>
        <label className="grow">{t('团队说明', 'Description')}<input value={draft.description} onChange={(event) => updateTeam({ description: event.target.value })} /></label>
        <label>{t('并发数', 'Concurrency')}<input className="number-input" type="number" min={1} max={8} value={draft.concurrency} onChange={(event) => updateTeam({ concurrency: Number(event.target.value) })} /></label>
        <button className="button secondary" onClick={addAgent}><UserRoundPlus size={16} />{t('添加成员', 'Add agent')}</button>
      </div>

      <div className="studio-workspace">
        <section className="tree-canvas">
          <AgentTree team={draft} onSelect={selectAgent} />
          <div className="status-legend">
            {(['idle', 'planning', 'running', 'waiting', 'blocked', 'failed', 'completed'] as const).map((status) => (
              <span key={status}><i className={`status-${status}`} />{language === 'en' ? statusLabels[status].en : statusLabels[status].zh}</span>
            ))}
          </div>
        </section>

        {selectedAgent && (
          <aside className="inspector">
            <div className="inspector-heading">
              <div className="agent-avatar large" style={{ color: selectedAgent.color, backgroundColor: `${selectedAgent.color}18` }}>{selectedAgent.name.slice(0, 1)}</div>
              <div><span className="section-label">AGENT PROFILE</span><h2>{selectedAgent.name}</h2></div>
              {selectedAgent.id !== draft.chiefAgentId && <button className="icon-button danger" title={t('删除成员', 'Delete agent')} onClick={removeAgent}><Trash2 size={16} /></button>}
            </div>

            <div className="form-grid">
              <label>{t('成员名称', 'Agent name')}<input value={selectedAgent.name} onChange={(event) => updateAgent({ name: event.target.value })} /></label>
              <label>{t('职位名称', 'Job title')}<input value={selectedAgent.title} onChange={(event) => updateAgent({ title: event.target.value })} /></label>
              <label>{t('角色类型', 'Role')}<select value={selectedAgent.role} disabled={selectedAgent.id === draft.chiefAgentId} onChange={(event) => { const role = event.target.value as AgentRole; updateAgent({ role, color: roleColors[role] }) }}>
                {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{language === 'en' ? label.en : label.zh}</option>)}
              </select></label>
              <label>{t('身份颜色', 'Identity color')}<div className="color-field"><input type="color" value={selectedAgent.color} onChange={(event) => updateAgent({ color: event.target.value })} /><span>{selectedAgent.color}</span></div></label>
            </div>

            <div className="inspector-section">
              <h3>{t('模型绑定', 'Model binding')}</h3>
              <label>{t('供应商', 'Provider')}<select value={selectedAgent.model.connectionId} onChange={(event) => updateAgent({ model: { ...selectedAgent.model, connectionId: event.target.value } })}>
                {snapshot!.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.status === 'ready' ? '' : ` · ${t('未配置', 'Not configured')}`}</option>)}
              </select></label>
              <label>{t('模型 ID', 'Model ID')}<input list={`models-${selectedAgent.id}`} value={selectedAgent.model.modelId} placeholder={t('输入或选择模型 ID', 'Enter or select a model ID')} onChange={(event) => updateAgent({ model: { ...selectedAgent.model, modelId: event.target.value } })} /><datalist id={`models-${selectedAgent.id}`}>{primaryProvider?.models.map((model) => <option key={model} value={model} />)}</datalist></label>
              <label>{t('备用供应商', 'Fallback provider')}<select value={selectedAgent.model.fallbackConnectionId ?? ''} onChange={(event) => updateAgent({ model: { ...selectedAgent.model, fallbackConnectionId: event.target.value || undefined, fallbackModelId: event.target.value ? selectedAgent.model.fallbackModelId : undefined } })}><option value="">{t('不使用备用模型', 'No fallback model')}</option>{snapshot!.providers.filter((provider) => provider.id !== selectedAgent.model.connectionId).map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.status === 'ready' ? '' : ` · ${t('未配置', 'Not configured')}`}</option>)}</select></label>
              {selectedAgent.model.fallbackConnectionId && <label>{t('备用模型 ID', 'Fallback model ID')}<input list={`fallback-models-${selectedAgent.id}`} value={selectedAgent.model.fallbackModelId ?? ''} placeholder={t('输入或选择备用模型 ID', 'Enter or select a fallback model ID')} onChange={(event) => updateAgent({ model: { ...selectedAgent.model, fallbackModelId: event.target.value } })} /><datalist id={`fallback-models-${selectedAgent.id}`}>{fallbackProvider?.models.map((model) => <option key={model} value={model} />)}</datalist></label>}
              <label>{t('创造性', 'Creativity')} <span className="range-value">{selectedAgent.model.temperature.toFixed(1)}</span><input type="range" min={0} max={1} step={0.1} value={selectedAgent.model.temperature} onChange={(event) => updateAgent({ model: { ...selectedAgent.model, temperature: Number(event.target.value) } })} /></label>
              <label>{t('Agent 费用上限（可选）', 'Agent budget limit (optional)')}<input type="number" min={0} placeholder={t('使用应用当前货币', 'Uses the app currency')} value={selectedAgent.budgetLimit ?? ''} onChange={(event) => updateAgent({ budgetLimit: event.target.value ? Number(event.target.value) : undefined })} /></label>
            </div>

            <div className="inspector-section">
              <h3>{t('工作指令', 'Instructions')}</h3>
              <label>{t('职责与行为', 'Responsibilities and behavior')}<textarea rows={5} value={selectedAgent.instructions} onChange={(event) => updateAgent({ instructions: event.target.value })} /></label>
              <label>{t('交付要求', 'Output requirements')}<textarea rows={3} value={selectedAgent.outputContract} onChange={(event) => updateAgent({ outputContract: event.target.value })} /></label>
            </div>

            <div className="inspector-section">
              <h3>{t('工具权限', 'Tool permissions')}</h3>
              <div className="tool-permissions">{availableTools.map((tool) => <label key={tool.id}><input type="checkbox" checked={selectedAgent.tools.includes(tool.id)} onChange={(event) => updateAgent({ tools: event.target.checked ? [...selectedAgent.tools, tool.id] : selectedAgent.tools.filter((id) => id !== tool.id) })} /><span><strong>{tool.label}</strong><small>{tool.detail}</small></span></label>)}</div>
            </div>
          </aside>
        )}
      </div>

      {snapshot!.teams.length > 1 && <button className="delete-team-button" onClick={() => void deleteTeam(draft.id)}><Trash2 size={14} />{t('删除当前团队', 'Delete current team')}</button>}
    </div>
  )
}

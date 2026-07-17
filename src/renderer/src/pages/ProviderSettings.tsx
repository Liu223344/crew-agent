import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, KeyRound, Plus, RefreshCw, Save, ServerCog, ShieldCheck, Trash2, Upload } from 'lucide-react'
import type { AppSettings, McpProbeResult, McpServerDefinition, ProviderConnection, ProviderKind, ProviderProbeResult, SaveMcpServerInput, SaveProviderInput } from '@shared/contracts'
import { PageHeader } from '../components/PageHeader'
import { useAppStore } from '../store'
import { useLocale } from '../i18n'

export function ProviderSettings(): React.JSX.Element {
  const { snapshot, saveProvider, testProvider, saveSettings, saveMcpServer, testMcpServer, deleteMcpServer, exportData, importData } = useAppStore()
  const { t } = useLocale()
  const [selectedId, setSelectedId] = useState(snapshot!.providers[0]?.id)
  const selected = snapshot!.providers.find((provider) => provider.id === selectedId) ?? snapshot!.providers[0]
  const [form, setForm] = useState<SaveProviderInput>(toForm(selected))
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<ProviderProbeResult | null>(null)

  useEffect(() => {
    setForm(toForm(selected))
    setProbeResult(null)
  }, [selected?.id])

  const probe = async (): Promise<void> => {
    setProbing(true)
    setProbeResult(null)
    try {
      await saveProvider(form)
      const result = await testProvider(form.id)
      setProbeResult(result)
      setForm((value) => ({ ...value, models: result.models, status: result.ok ? 'ready' : 'error' }))
    } catch (error) {
      setProbeResult({
        providerId: form.id,
        ok: false,
        models: form.models,
        latencyMs: 0,
        capabilities: form.capabilities,
        message: error instanceof Error ? error.message : '连接测试失败'
      })
    } finally {
      setProbing(false)
    }
  }

  const addCustom = (): void => {
    const provider: ProviderConnection = {
      id: crypto.randomUUID(),
      name: '自定义模型服务',
      kind: 'openai-compatible',
      baseUrl: '',
      status: 'unconfigured',
      hasSecret: false,
      models: [],
      capabilities: { streaming: true, toolCalling: true, structuredOutput: false, vision: false },
      updatedAt: new Date().toISOString()
    }
    setSelectedId(provider.id)
    setForm(toForm(provider))
  }

  return (
    <div className="page settings-page">
      <PageHeader eyebrow="CONNECTIONS" title={t('模型与设置', 'Models & settings')} description={t('每位 Agent 都能独立选择供应商和模型，密钥只保存在这台电脑。', 'Each agent can choose its own provider and model. Secrets stay on this computer.')} actions={<button className="button secondary" onClick={addCustom}><Plus size={16} />{t('自定义端点', 'Custom endpoint')}</button>} />
      <div className="settings-layout">
        <aside className="provider-list">
          <div className="run-list-title"><span>{t('模型供应商', 'Model providers')}</span><b>{snapshot!.providers.length}</b></div>
          {snapshot!.providers.map((provider) => <button key={provider.id} className={provider.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(provider.id)}><div className="provider-logo">{provider.name.slice(0, 2).toUpperCase()}</div><div><strong>{provider.name}</strong><span>{provider.kind === 'openai-compatible' ? 'OpenAI 兼容' : provider.kind}</span></div><i className={provider.status} /></button>)}
        </aside>
        <section className="provider-editor">
          <div className="provider-title"><div className="provider-logo large">{form.name.slice(0, 2).toUpperCase()}</div><div><span className="section-label">PROVIDER PROFILE</span><h2>{form.name}</h2></div><span className={`connection-state ${selected?.status ?? 'unconfigured'}`}>{selected?.status === 'ready' ? <><CheckCircle2 size={14} />{t('已连接', 'Connected')}</> : selected?.status === 'error' ? <><AlertCircle size={14} />{t('连接异常', 'Connection error')}</> : t('尚未配置', 'Not configured')}</span></div>
          <div className="form-grid two">
            <label>{t('显示名称', 'Display name')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>{t('协议类型', 'Protocol')}<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as ProviderKind })}><option value="openai">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option><option value="openai-compatible">{t('OpenAI 兼容', 'OpenAI compatible')}</option></select></label>
          </div>
          <label>Base URL<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></label>
          <label>API Key<div className="secret-input"><KeyRound size={16} /><input type="password" value={form.apiKey ?? ''} placeholder={selected?.hasSecret ? t('密钥已安全保存，输入新值可替换', 'Secret saved securely. Enter a new value to replace it.') : t('输入 API Key', 'Enter API key')} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></div></label>
          <label>{t('模型 ID', 'Model IDs')}<div className="tag-input"><input placeholder={t('输入模型 ID 后按回车', 'Enter a model ID and press Return')} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const value = event.currentTarget.value.trim(); if (value && !form.models.includes(value)) setForm({ ...form, models: [...form.models, value] }); event.currentTarget.value = '' } }} /></div></label>
          <div className="model-tags">{form.models.map((model) => <button key={model} onClick={() => setForm({ ...form, models: form.models.filter((item) => item !== model) })}>{model}<span>×</span></button>)}{form.models.length === 0 && <span>{t('还没有添加模型，Agent 也可以直接手动填写模型 ID。', 'No models added yet. Agents can still enter a model ID manually.')}</span>}</div>
          <div className="capability-grid">
            {Object.entries(form.capabilities).map(([key, value]) => <label key={key}><input type="checkbox" checked={value} onChange={(event) => setForm({ ...form, capabilities: { ...form.capabilities, [key]: event.target.checked } })} /><span>{({ streaming: t('流式输出', 'Streaming'), toolCalling: t('工具调用', 'Tool calls'), structuredOutput: t('结构化输出', 'Structured output'), vision: t('图片理解', 'Vision') } as Record<string, string>)[key]}</span></label>)}
          </div>
          <div className="security-note"><ShieldCheck size={18} /><div><strong>{t('密钥不会进入团队模板', 'Secrets are excluded from team templates')}</strong><span>{t('Bossy 使用系统加密存储，Renderer 和导出的配置都无法读取明文。', 'Bossy uses system encryption. The renderer and exported files cannot read plaintext secrets.')}</span></div></div>
          {probeResult && <div className={`probe-result ${probeResult.ok ? 'success' : 'error'}`}>{probeResult.ok ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<div><strong>{probeResult.message}</strong><span>{probeResult.latencyMs > 0 ? `${probeResult.latencyMs} ms · ` : ''}{probeResult.models.length} 个可用模型</span></div></div>}
          <div className="editor-actions"><button className="button secondary" disabled={probing} onClick={() => void probe()}><RefreshCw className={probing ? 'spin' : ''} size={16} />{probing ? t('正在测试', 'Testing') : t('测试并刷新模型', 'Test and refresh models')}</button><button className="button primary" disabled={probing} onClick={() => void saveProvider(form)}><Save size={16} />{t('保存连接', 'Save connection')}</button></div>
        </section>
        <aside className="app-preferences">
          <div><span className="section-label">APP SETTINGS</span><h2>{t('应用偏好', 'Preferences')}</h2></div>
          <PreferenceForm value={snapshot!.settings} providers={snapshot!.providers} onSave={saveSettings} onExport={exportData} onImport={importData} />
          <McpSettings servers={snapshot!.mcpServers} onSave={saveMcpServer} onTest={testMcpServer} onDelete={deleteMcpServer} />
        </aside>
      </div>
    </div>
  )
}

function McpSettings({ servers, onSave, onTest, onDelete }: { servers: McpServerDefinition[]; onSave: (server: SaveMcpServerInput) => Promise<void>; onTest: (serverId: string) => Promise<McpProbeResult>; onDelete: (serverId: string) => Promise<void> }): React.JSX.Element {
  const { t } = useLocale()
  const [form, setForm] = useState<SaveMcpServerInput | null>(null)
  const [result, setResult] = useState<McpProbeResult | null>(null)
  const [testing, setTesting] = useState(false)
  const edit = (server: McpServerDefinition): void => { setForm({ ...server, authToken: '' }); setResult(null) }
  const add = (): void => setForm({ id: crypto.randomUUID(), name: '新 MCP 服务', transport: 'stdio', command: '', args: [], status: 'unconfigured', tools: [], authToken: '' })
  const test = async (): Promise<void> => {
    if (!form) return
    setTesting(true)
    try {
      await onSave(form)
      const next = await onTest(form.id)
      setResult(next)
      setForm({ ...form, status: next.ok ? 'ready' : 'error', tools: next.tools, authToken: '' })
    } finally {
      setTesting(false)
    }
  }
  return <div className="mcp-summary"><div className="mcp-heading"><div><ServerCog size={18} /><strong>{t('MCP 工具服务', 'MCP tool servers')}</strong></div><button className="icon-button" title={t('添加 MCP', 'Add MCP server')} onClick={add}><Plus size={13} /></button></div>{form ? <div className="mcp-form"><label>{t('名称', 'Name')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>{t('传输', 'Transport')}<select value={form.transport} onChange={(event) => setForm({ ...form, transport: event.target.value as SaveMcpServerInput['transport'] })}><option value="stdio">{t('本地 stdio', 'Local stdio')}</option><option value="http">Streamable HTTP</option></select></label>{form.transport === 'stdio' ? <><label>{t('命令', 'Command')}<input value={form.command ?? ''} placeholder="npx" onChange={(event) => setForm({ ...form, command: event.target.value })} /></label><label>{t('参数', 'Arguments')}<input value={form.args.join(' ')} placeholder="-y @scope/server" onChange={(event) => setForm({ ...form, args: event.target.value.split(/\s+/).filter(Boolean) })} /></label></> : <><label>URL<input value={form.url ?? ''} placeholder="https://host/mcp" onChange={(event) => setForm({ ...form, url: event.target.value })} /></label><label>Bearer Token<input type="password" value={form.authToken ?? ''} placeholder={servers.find((item) => item.id === form.id)?.hasSecret ? t('已安全保存', 'Saved securely') : t('可选', 'Optional')} onChange={(event) => setForm({ ...form, authToken: event.target.value })} /></label></>}{result && <span className={result.ok ? 'mcp-ok' : 'mcp-error'}>{result.message}</span>}<div><button className="text-button" onClick={() => setForm(null)}>{t('返回', 'Back')}</button><button className="button secondary" onClick={() => void onSave(form)}>{t('保存', 'Save')}</button><button className="button primary" disabled={testing} onClick={() => void test()}>{testing ? t('测试中', 'Testing') : t('连接测试', 'Test connection')}</button></div></div> : <div className="mcp-list">{servers.map((server) => <button key={server.id} onClick={() => edit(server)}><i className={server.status} /><span><strong>{server.name}</strong><small>{server.transport} · {server.tools.length} {t('个工具', 'tools')}</small></span><b>›</b></button>)}{servers.length === 0 && <span>{t('连接本地或远程 MCP 后，可逐个授权工具给 Agent。', 'Connect a local or remote MCP server, then grant tools to agents individually.')}</span>}</div>}{form && servers.some((server) => server.id === form.id) && <button className="delete-mcp" onClick={() => void onDelete(form.id).then(() => setForm(null))}><Trash2 size={12} />{t('删除服务', 'Delete server')}</button>}</div>
}

function PreferenceForm({ value, providers, onSave, onExport, onImport }: { value: AppSettings; providers: ProviderConnection[]; onSave: (settings: AppSettings) => Promise<void>; onExport: () => Promise<string | null>; onImport: () => Promise<void> }): React.JSX.Element {
  const { t } = useLocale()
  const [settings, setSettings] = useState(value)
  useEffect(() => setSettings(value), [value])
  const updatePrice = (index: number, patch: Partial<AppSettings['pricing'][number]>): void => setSettings({ ...settings, pricing: settings.pricing.map((price, current) => current === index ? { ...price, ...patch } : price) })
  return <div className="preference-form"><label>{t('界面语言', 'Language')}<select value={settings.language} onChange={(event) => setSettings({ ...settings, language: event.target.value as AppSettings['language'] })}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><label>{t('外观', 'Appearance')}<select value={settings.theme} onChange={(event) => setSettings({ ...settings, theme: event.target.value as AppSettings['theme'] })}><option value="system">{t('跟随系统', 'System')}</option><option value="light">{t('浅色', 'Light')}</option><option value="dark">{t('深色', 'Dark')}</option></select></label><label>{t('费用货币', 'Currency')}<select value={settings.currency} onChange={(event) => setSettings({ ...settings, currency: event.target.value as AppSettings['currency'] })}><option value="CNY">CNY ¥</option><option value="USD">USD $</option></select></label><label>{t('默认审批策略', 'Default approval policy')}<select value={settings.approvalPolicy} onChange={(event) => setSettings({ ...settings, approvalPolicy: event.target.value as AppSettings['approvalPolicy'] })}><option value="risky">{t('仅风险操作', 'Risky operations only')}</option><option value="all-tools">{t('所有工具调用', 'Every tool call')}</option></select></label><div className="pricing-editor"><div><strong>{t('模型价格', 'Model pricing')}</strong><button className="icon-button" title={t('添加价格', 'Add price')} onClick={() => setSettings({ ...settings, pricing: [...settings.pricing, { providerId: providers[0]?.id ?? '', modelId: '', inputPerMillion: 0, outputPerMillion: 0 }] })}><Plus size={13} /></button></div>{settings.pricing.map((price, index) => <div className="price-row" key={`${index}-${price.providerId}`}><select value={price.providerId} onChange={(event) => updatePrice(index, { providerId: event.target.value })}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select><input value={price.modelId} placeholder={t('模型 ID', 'Model ID')} onChange={(event) => updatePrice(index, { modelId: event.target.value })} /><label>{t('输入 / 百万', 'Input / million')}<input type="number" min={0} value={price.inputPerMillion} onChange={(event) => updatePrice(index, { inputPerMillion: Number(event.target.value) })} /></label><label>{t('输出 / 百万', 'Output / million')}<input type="number" min={0} value={price.outputPerMillion} onChange={(event) => updatePrice(index, { outputPerMillion: Number(event.target.value) })} /></label><button className="icon-button danger" title={t('删除价格', 'Delete price')} onClick={() => setSettings({ ...settings, pricing: settings.pricing.filter((_, current) => current !== index) })}><Trash2 size={13} /></button></div>)}{settings.pricing.length === 0 && <span>{t('未配置价格时仍记录 Token，但费用显示为 0。', 'Tokens are still tracked without pricing, but estimated cost remains zero.')}</span>}</div><button className="button secondary" onClick={() => void onSave(settings)}>{t('保存偏好与价格', 'Save preferences and pricing')}</button><div className="data-actions"><button className="button secondary" onClick={() => void onExport()}><Download size={13} />{t('导出数据', 'Export data')}</button><button className="button secondary" onClick={() => void onImport()}><Upload size={13} />{t('导入数据', 'Import data')}</button></div></div>
}

function toForm(provider: ProviderConnection): SaveProviderInput {
  return { id: provider.id, name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, status: provider.status, models: provider.models, capabilities: provider.capabilities, apiKey: '' }
}

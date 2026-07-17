import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Plus, Save, ServerCog, ShieldCheck } from 'lucide-react'
import type { AppSettings, ProviderConnection, ProviderKind, SaveProviderInput } from '@shared/contracts'
import { PageHeader } from '../components/PageHeader'
import { useAppStore } from '../store'

export function ProviderSettings(): React.JSX.Element {
  const { snapshot, saveProvider, saveSettings } = useAppStore()
  const [selectedId, setSelectedId] = useState(snapshot!.providers[0]?.id)
  const selected = snapshot!.providers.find((provider) => provider.id === selectedId) ?? snapshot!.providers[0]
  const [form, setForm] = useState<SaveProviderInput>(toForm(selected))

  useEffect(() => setForm(toForm(selected)), [selected])

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
      <PageHeader eyebrow="CONNECTIONS" title="模型与设置" description="每位 Agent 都能独立选择供应商和模型，密钥只保存在这台电脑。" actions={<button className="button secondary" onClick={addCustom}><Plus size={16} />自定义端点</button>} />
      <div className="settings-layout">
        <aside className="provider-list">
          <div className="run-list-title"><span>模型供应商</span><b>{snapshot!.providers.length}</b></div>
          {snapshot!.providers.map((provider) => <button key={provider.id} className={provider.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(provider.id)}><div className="provider-logo">{provider.name.slice(0, 2).toUpperCase()}</div><div><strong>{provider.name}</strong><span>{provider.kind === 'openai-compatible' ? 'OpenAI 兼容' : provider.kind}</span></div><i className={provider.status} /></button>)}
        </aside>
        <section className="provider-editor">
          <div className="provider-title"><div className="provider-logo large">{form.name.slice(0, 2).toUpperCase()}</div><div><span className="section-label">PROVIDER PROFILE</span><h2>{form.name}</h2></div><span className={`connection-state ${selected?.status ?? 'unconfigured'}`}>{selected?.status === 'ready' ? <><CheckCircle2 size={14} />已连接</> : '尚未配置'}</span></div>
          <div className="form-grid two">
            <label>显示名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>协议类型<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as ProviderKind })}><option value="openai">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option><option value="openai-compatible">OpenAI 兼容</option></select></label>
          </div>
          <label>Base URL<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></label>
          <label>API Key<div className="secret-input"><KeyRound size={16} /><input type="password" value={form.apiKey ?? ''} placeholder={selected?.hasSecret ? '密钥已安全保存，输入新值可替换' : '输入 API Key'} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></div></label>
          <label>模型 ID<div className="tag-input"><input placeholder="输入模型 ID 后按回车" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const value = event.currentTarget.value.trim(); if (value && !form.models.includes(value)) setForm({ ...form, models: [...form.models, value] }); event.currentTarget.value = '' } }} /></div></label>
          <div className="model-tags">{form.models.map((model) => <button key={model} onClick={() => setForm({ ...form, models: form.models.filter((item) => item !== model) })}>{model}<span>×</span></button>)}{form.models.length === 0 && <span>还没有添加模型，Agent 也可以直接手动填写模型 ID。</span>}</div>
          <div className="capability-grid">
            {Object.entries(form.capabilities).map(([key, value]) => <label key={key}><input type="checkbox" checked={value} onChange={(event) => setForm({ ...form, capabilities: { ...form.capabilities, [key]: event.target.checked } })} /><span>{({ streaming: '流式输出', toolCalling: '工具调用', structuredOutput: '结构化输出', vision: '图片理解' } as Record<string, string>)[key]}</span></label>)}
          </div>
          <div className="security-note"><ShieldCheck size={18} /><div><strong>密钥不会进入团队模板</strong><span>Bossy 使用系统加密存储，Renderer 和导出的配置都无法读取明文。</span></div></div>
          <div className="editor-actions"><button className="button primary" onClick={() => void saveProvider(form)}><Save size={16} />保存连接</button></div>
        </section>
        <aside className="app-preferences">
          <div><span className="section-label">APP SETTINGS</span><h2>应用偏好</h2></div>
          <PreferenceForm value={snapshot!.settings} onSave={saveSettings} />
          <div className="mcp-summary"><ServerCog size={20} /><strong>MCP 工具服务</strong><span>本地 stdio 与远程 HTTP 连接将在工具中心统一管理。</span><button className="button secondary" disabled>打开工具中心</button></div>
        </aside>
      </div>
    </div>
  )
}

function PreferenceForm({ value, onSave }: { value: AppSettings; onSave: (settings: AppSettings) => Promise<void> }): React.JSX.Element {
  const [settings, setSettings] = useState(value)
  useEffect(() => setSettings(value), [value])
  return <div className="preference-form"><label>界面语言<select value={settings.language} onChange={(event) => setSettings({ ...settings, language: event.target.value as AppSettings['language'] })}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><label>外观<select value={settings.theme} onChange={(event) => setSettings({ ...settings, theme: event.target.value as AppSettings['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>费用货币<select value={settings.currency} onChange={(event) => setSettings({ ...settings, currency: event.target.value as AppSettings['currency'] })}><option value="CNY">CNY ¥</option><option value="USD">USD $</option></select></label><button className="button secondary" onClick={() => void onSave(settings)}>保存偏好</button></div>
}

function toForm(provider: ProviderConnection): SaveProviderInput {
  return { id: provider.id, name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, status: provider.status, models: provider.models, capabilities: provider.capabilities, apiKey: '' }
}

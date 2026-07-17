import type { PropsWithChildren } from 'react'
import { Bot, Boxes, ChevronDown, CircleDollarSign, LayoutDashboard, Network, Settings2 } from 'lucide-react'
import clsx from 'clsx'
import { useAppStore, type AppPage } from '../store'
import { useLocale } from '../i18n'

const navItems: Array<{ id: AppPage; zh: string; en: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', zh: '工作台', en: 'Workspace', icon: LayoutDashboard },
  { id: 'team', zh: '团队树', en: 'Team tree', icon: Network },
  { id: 'runs', zh: '任务驾驶舱', en: 'Mission control', icon: Boxes },
  { id: 'providers', zh: '模型与设置', en: 'Models & settings', icon: Settings2 }
]

export function AppShell({ children }: PropsWithChildren): React.JSX.Element {
  const { page, setPage, snapshot, selectedTeamId, selectTeam } = useAppStore()
  const { t } = useLocale()
  const activeRuns = snapshot?.runs.filter((run) => run.status === 'running').length ?? 0
  const spend = snapshot?.runs.reduce((sum, run) => sum + run.estimatedCost, 0) ?? 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag" />
        <div className="brand-lockup">
          <div className="brand-mark">B</div>
          <div>
            <strong>Bossy</strong>
            <span>AI team workspace</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label={t('主导航', 'Primary navigation')}>
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={clsx('nav-button', page === item.id && 'active')}
                onClick={() => setPage(item.id)}
              >
                <Icon size={17} />
                <span>{t(item.zh, item.en)}</span>
                {item.id === 'runs' && activeRuns > 0 && <b>{activeRuns}</b>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-section">
          <span className="section-label">{t('当前团队', 'CURRENT TEAM')}</span>
          <label className="team-select">
            <Bot size={16} />
            <select value={selectedTeamId ?? ''} onChange={(event) => selectTeam(event.target.value)}>
              {snapshot?.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>

        <div className="sidebar-foot">
          <div className="sidebar-stat">
            <CircleDollarSign size={16} />
            <span>{t('累计估算', 'Estimated total')}</span>
            <strong>{snapshot?.settings.currency === 'CNY' ? '¥' : '$'}{spend.toFixed(2)}</strong>
          </div>
          <div className="local-badge">
            <span />
            {t('本地工作区', 'Local workspace')}
          </div>
        </div>
      </aside>
      <main className="main-stage">{children}</main>
    </div>
  )
}

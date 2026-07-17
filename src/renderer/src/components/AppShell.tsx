import type { PropsWithChildren } from 'react'
import { Bot, Boxes, ChevronDown, CircleDollarSign, LayoutDashboard, Network, Settings2 } from 'lucide-react'
import clsx from 'clsx'
import { useAppStore, type AppPage } from '../store'

const navItems: Array<{ id: AppPage; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { id: 'team', label: '团队树', icon: Network },
  { id: 'runs', label: '任务驾驶舱', icon: Boxes },
  { id: 'providers', label: '模型与设置', icon: Settings2 }
]

export function AppShell({ children }: PropsWithChildren): React.JSX.Element {
  const { page, setPage, snapshot, selectedTeamId, selectTeam } = useAppStore()
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

        <nav className="primary-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={clsx('nav-button', page === item.id && 'active')}
                onClick={() => setPage(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.id === 'runs' && activeRuns > 0 && <b>{activeRuns}</b>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-section">
          <span className="section-label">当前团队</span>
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
            <span>累计估算</span>
            <strong>¥{spend.toFixed(2)}</strong>
          </div>
          <div className="local-badge">
            <span />
            本地工作区
          </div>
        </div>
      </aside>
      <main className="main-stage">{children}</main>
    </div>
  )
}


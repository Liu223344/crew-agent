import { ArrowRight, Bot, CircleCheck, CircleDashed, Clock3, Network, Play, Plus, ServerCog } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useAppStore } from '../store'
import { useLocale } from '../i18n'

export function Dashboard(): React.JSX.Element {
  const { snapshot, setPage, createTeam, selectTeam, selectRun } = useAppStore()
  const { t, language } = useLocale()
  const teams = snapshot!.teams
  const runs = snapshot!.runs
  const providers = snapshot!.providers
  const readyProviders = providers.filter((provider) => provider.status === 'ready').length
  const activeRuns = runs.filter((run) => run.status === 'running' || run.status === 'paused')

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="BOSS OVERVIEW"
        title={t('早上好，老板', 'Good morning, boss')}
        description={t('你的 AI 团队、任务和模型连接都在这里。', 'Your AI teams, missions, and model connections are all here.')}
        actions={
          <>
            <button className="button secondary" onClick={() => void createTeam()}><Plus size={16} />{t('新建团队', 'New team')}</button>
            <button className="button primary" onClick={() => setPage('runs')}><Play size={16} />{t('下达任务', 'New mission')}</button>
          </>
        }
      />

      <section className="metrics-band" aria-label="工作区概览">
        <div className="metric">
          <Network size={18} />
          <span>{t('团队', 'Teams')}</span>
          <strong>{teams.length}</strong>
          <small>{teams.reduce((sum, team) => sum + team.agents.length, 0)} {t('位成员', 'members')}</small>
        </div>
        <div className="metric">
          <CircleDashed size={18} />
          <span>{t('运行中', 'Active')}</span>
          <strong>{activeRuns.length}</strong>
          <small>{runs.filter((run) => run.status === 'awaiting_approval').length} {t('个等待批准', 'awaiting approval')}</small>
        </div>
        <div className="metric">
          <ServerCog size={18} />
          <span>{t('模型连接', 'Model connections')}</span>
          <strong>{readyProviders}</strong>
          <small>{providers.length} {t('个供应商', 'providers')}</small>
        </div>
        <div className="metric">
          <CircleCheck size={18} />
          <span>{t('已完成', 'Completed')}</span>
          <strong>{runs.filter((run) => run.status === 'completed').length}</strong>
          <small>{runs.reduce((sum, run) => sum + run.usedTokens, 0).toLocaleString()} tokens</small>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel team-overview-panel">
          <div className="panel-heading">
            <div><span className="section-label">AI TEAMS</span><h2>{t('你的团队', 'Your teams')}</h2></div>
            <button className="text-button" onClick={() => setPage('team')}>{t('管理团队', 'Manage teams')}<ArrowRight size={15} /></button>
          </div>
          <div className="team-rows">
            {teams.map((team) => (
              <button
                className="team-row"
                key={team.id}
                onClick={() => { selectTeam(team.id); setPage('team') }}
              >
                <div className="team-row-icon"><Network size={19} /></div>
                <div className="team-row-copy">
                  <strong>{team.name}</strong>
                  <span>{team.description}</span>
                </div>
                <div className="avatar-stack" aria-label={`${team.agents.length} 位成员`}>
                  {team.agents.slice(0, 4).map((agent) => (
                    <i key={agent.id} style={{ backgroundColor: agent.color }}>{agent.name.slice(0, 1)}</i>
                  ))}
                </div>
                <span className="team-count">{team.agents.length} {t('人', 'agents')}</span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel activity-panel">
          <div className="panel-heading">
            <div><span className="section-label">RECENT RUNS</span><h2>{t('最近任务', 'Recent missions')}</h2></div>
            <button className="icon-button" title={t('查看任务驾驶舱', 'Open mission control')} onClick={() => setPage('runs')}><ArrowRight size={16} /></button>
          </div>
          {runs.length === 0 ? (
            <div className="empty-compact"><Bot size={28} /><strong>{t('还没有任务', 'No missions yet')}</strong><span>{t('给团队下达第一个目标。', 'Give your team its first goal.')}</span></div>
          ) : (
            <div className="activity-list">
              {runs.slice(0, 5).map((run) => (
                <button key={run.id} onClick={() => { selectRun(run.id); setPage('runs') }}>
                  <i className={`run-dot ${run.status}`} />
                  <div><strong>{run.title}</strong><span>{run.tasks.filter((task) => task.status === 'completed').length}/{run.tasks.length} {t('个任务完成', 'tasks complete')}</span></div>
                  <time><Clock3 size={13} />{formatRelative(run.updatedAt, language)}</time>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="connection-strip">
        <div><span className="section-label">MODEL ROUTER</span><strong>{t('每位成员都可以使用不同模型', 'Each agent can use a different model')}</strong></div>
        <div className="provider-pills">
          {providers.map((provider) => (
            <button key={provider.id} onClick={() => setPage('providers')}>
              <i className={provider.status} />{provider.name}<span>{provider.status === 'ready' ? t('已连接', 'Connected') : t('待配置', 'Not configured')}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function formatRelative(value: string, language: 'zh-CN' | 'en'): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 60) return language === 'en' ? `${minutes}m ago` : `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return language === 'en' ? `${hours}h ago` : `${hours} 小时前`
  return language === 'en' ? `${Math.round(hours / 24)}d ago` : `${Math.round(hours / 24)} 天前`
}

import { useEffect } from 'react'
import { LoaderCircle } from 'lucide-react'
import { AppShell } from './components/AppShell'
import { Dashboard } from './pages/Dashboard'
import { ProviderSettings } from './pages/ProviderSettings'
import { RunCockpit } from './pages/RunCockpit'
import { TeamStudio } from './pages/TeamStudio'
import { useAppStore } from './store'
import { useLocale } from './i18n'

export default function App(): React.JSX.Element {
  const { initialize, loading, page, snapshot } = useAppStore()
  const { t } = useLocale()

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    void initialize().then((cleanup) => {
      unsubscribe = cleanup
    })
    return () => unsubscribe?.()
  }, [initialize])

  useEffect(() => {
    if (!snapshot) return
    const theme = snapshot.settings.theme
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.lang = snapshot.settings.language
  }, [snapshot])

  if (loading || !snapshot) {
    return (
      <div className="app-loading">
        <div className="brand-mark">B</div>
        <LoaderCircle className="spin" size={18} />
        <span>{t('正在启动 Bossy', 'Starting Bossy')}</span>
      </div>
    )
  }

  return (
    <AppShell>
      {page === 'dashboard' && <Dashboard />}
      {page === 'team' && <TeamStudio />}
      {page === 'runs' && <RunCockpit />}
      {page === 'providers' && <ProviderSettings />}
    </AppShell>
  )
}

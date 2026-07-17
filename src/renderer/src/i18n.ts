import { useAppStore } from './store'

export function useLocale(): { language: 'zh-CN' | 'en'; t: (zh: string, en: string) => string } {
  const language = useAppStore((state) => state.snapshot?.settings.language ?? 'zh-CN')
  return { language, t: (zh, en) => language === 'en' ? en : zh }
}


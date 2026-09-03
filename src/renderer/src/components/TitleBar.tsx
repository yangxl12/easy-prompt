import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store/config'
import type { ThemeMode, Language } from '@shared/types'
import { LANGUAGES } from '@shared/i18n'
import { SunIcon, MoonIcon, SettingsIcon, GlobeIcon, SearchIcon } from './ui/icons'
import { Button } from './ui/Button'

interface TitleBarProps {
  onOpenSettings: () => void
  /** Toggle the workspace-wide search panel. */
  onToggleSearch: () => void
}

export default function TitleBar({
  onOpenSettings,
  onToggleSearch
}: TitleBarProps): JSX.Element {
  const { t } = useTranslation()
  const { config, setTheme, setLanguage } = useConfigStore()

  const cycleTheme = (): void => {
    const order: ThemeMode[] = ['light', 'dark', 'system']
    const idx = order.indexOf(config.app.theme)
    void setTheme(order[(idx + 1) % order.length])
  }

  const themeLabel: Record<ThemeMode, string> = {
    light: t('settings.light'),
    dark: t('settings.dark'),
    system: t('settings.system')
  }

  return (
    <header
      className={`flex h-11 shrink-0 items-center justify-between border-b border-border bg-bg-surface ${window.api.platform === 'darwin' ? 'pl-20 pr-3' : 'px-3'}`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-accent">✦</span>
        <span>{t('app.title')}</span>
        <span className="text-xs font-normal text-text-muted">{t('app.tagline')}</span>
      </div>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Global search across the workspace */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleSearch}
          title={t('globalSearch.toggle')}
        >
          <SearchIcon />
        </Button>

        {/* Language */}
        <label className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-muted hover:bg-bg-subtle">
          <GlobeIcon />
          <select
            className="bg-transparent text-xs outline-none"
            value={config.app.language}
            onChange={(e) => void setLanguage(e.target.value as Language)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        {/* Theme */}
        <Button variant="ghost" size="sm" onClick={cycleTheme} title={themeLabel[config.app.theme]}>
          {config.app.theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          <span className="hidden sm:inline">{themeLabel[config.app.theme]}</span>
        </Button>

        {/* Settings */}
        <Button variant="ghost" size="sm" onClick={onOpenSettings} title={t('settings.title')}>
          <SettingsIcon />
        </Button>
      </div>
    </header>
  )
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore, resolveTheme } from './store/config'
import { useWorkspaceStore } from './store/workspace'
import { initI18n } from './i18n'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'
import SettingsDialog from './components/SettingsDialog'
import { ContextMenuProvider } from './components/ui/ContextMenu'

export default function App(): JSX.Element {
  const { config, loaded, setConfig } = useConfigStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { i18n } = useTranslation()

  // Bootstrap: load config from main, init i18n, subscribe to config changes.
  useEffect(() => {
    void (async () => {
      const initial = await window.api.getConfig()
      initI18n(initial.app.language)
      setConfig(initial)
    })()
    const unsub = window.api.onConfigChanged((next) => setConfig(next))
    return unsub
  }, [setConfig])

  // Listen for tray menu actions.
  useEffect(() => {
    const unsubNew = window.api.onTrayNewPrompt(() => {
      // Create a new draft tab in the workspace (matches Workspace.tsx convention).
      const { openFile } = useWorkspaceStore.getState()
      openFile(`draft://${Date.now()}`, 'Untitled', '')
    })
    const unsubSettings = window.api.onTrayOpenSettings(() => {
      setSettingsOpen(true)
    })
    return () => {
      unsubNew()
      unsubSettings()
    }
  }, [])

  // Prompt before closing if there are unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      const tabs = useWorkspaceStore.getState().tabs
      const hasDirty = tabs.some((t) => t.dirtyContent !== null)
      if (hasDirty) {
        e.preventDefault()
        e.returnValue = '' as never
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Global keyboard shortcut: Ctrl+B / Cmd+B toggles sidebar.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        const { config, patchConfig } = useConfigStore.getState()
        void patchConfig({ app: { sidebarCollapsed: !config.app.sidebarCollapsed } })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Apply theme class on document root whenever mode changes.
  useEffect(() => {
    const resolved = resolveTheme(config.app.theme)
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [config.app.theme])

  // Keep i18n in sync if language changes from elsewhere (e.g. settings).
  useEffect(() => {
    if (i18n.language !== config.app.language) {
      void i18n.changeLanguage(config.app.language)
      document.documentElement.lang = config.app.language
    }
  }, [config.app.language, i18n])

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading…
      </div>
    )
  }

  return (
    <ContextMenuProvider>
      <div className="flex h-full flex-col bg-bg-base text-text">
        <TitleBar onOpenSettings={() => setSettingsOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
          <Workspace onOpenSettings={() => setSettingsOpen(true)} />
        </div>
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      </div>
    </ContextMenuProvider>
  )
}

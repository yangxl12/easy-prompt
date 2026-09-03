import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore, resolveTheme } from './store/config'
import { useWorkspaceStore } from './store/workspace'
import { initI18n } from './i18n'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'
import SettingsDialog from './components/SettingsDialog'
import GlobalSearchPanel from './components/GlobalSearchPanel'
import { ContextMenuProvider } from './components/ui/ContextMenu'

export default function App(): JSX.Element {
  const { config, loaded, setConfig } = useConfigStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchPos, setSearchPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Offset captured at drag start so the panel doesn't jump to the cursor.
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
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

  // Global keyboard shortcut: Ctrl+Shift+F / Cmd+Shift+F opens global search.
  // CodeMirror doesn't bind this combination, so it bubbles up from the editor.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        toggleSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toggle the search panel; center it the first time it opens (subsequent
  // opens keep the last dragged position).
  const toggleSearch = (): void => {
    if (!searchOpen) {
      setSearchPos((p) =>
        p.x === 0 && p.y === 0
          ? { x: Math.max(16, Math.round((window.innerWidth - 640) / 2)), y: 72 }
          : p
      )
    }
    setSearchOpen((open) => !open)
  }

  // Drag the floating search panel by its grip handle. Position is clamped to the
  // viewport so the panel can't be lost off-screen.
  const onDragHandleMouseDown = (e: React.MouseEvent): void => {
    dragOffset.current = { dx: e.clientX - searchPos.x, dy: e.clientY - searchPos.y }
  }
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragOffset.current) return
      const x = Math.max(8, Math.min(e.clientX - dragOffset.current.dx, window.innerWidth - 360))
      const y = Math.max(8, Math.min(e.clientY - dragOffset.current.dy, window.innerHeight - 120))
      setSearchPos({ x, y })
    }
    const onUp = (): void => {
      dragOffset.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
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
      <div className="relative flex h-full flex-col bg-bg-base text-text">
        <TitleBar
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleSearch={toggleSearch}
        />
        {searchOpen && (
          <GlobalSearchPanel
            floating
            style={{ top: searchPos.y, left: searchPos.x }}
            onDragHandleMouseDown={onDragHandleMouseDown}
            onClose={() => setSearchOpen(false)}
          />
        )}
        <div className="flex min-h-0 flex-1">
          <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
          <Workspace onOpenSettings={() => setSettingsOpen(true)} />
        </div>
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      </div>
    </ContextMenuProvider>
  )
}

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore } from '../store/workspace'
import { watchTree, createFile } from '../services/fileOps'
import FileTreeView from './FileTree/FileTreeView'
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon } from './ui/icons'
import { useWorkspaceRoot } from '../services/workspaceRoot'

interface SidebarProps {
  onOpenSettings: () => void
}

export default function Sidebar({ onOpenSettings }: SidebarProps): JSX.Element {
  const { t } = useTranslation()
  const config = useConfigStore((s) => s.config)
  const patchConfig = useConfigStore((s) => s.patchConfig)
  const aiReady = useConfigStore((s) => s.aiReady())
  const tree = useWorkspaceStore((s) => s.tree)
  const setTree = useWorkspaceStore((s) => s.setTree)
  const openFile = useWorkspaceStore((s) => s.openFile)
  const root = useWorkspaceRoot()
  const collapsed = config.app.sidebarCollapsed

  // Subscribe to workspace tree changes on mount.
  useEffect(() => {
    const unsub = watchTree((next) => setTree(next))
    return unsub
  }, [setTree])

  const handleNewFile = async (): Promise<void> => {
    if (!root) return
    const path = await createFile(root, t('tree.newFileName'))
    const { readFile } = window.api
    const content = await readFile(path)
    openFile(path, path.split('/').pop() ?? '', content)
  }

  const toggleCollapse = (): void => {
    void patchConfig({ app: { sidebarCollapsed: !collapsed } })
  }

  // When collapsed, render a thin strip with an expand button only.
  if (collapsed) {
    return (
      <aside className="flex shrink-0 flex-col border-r border-border bg-bg-surface">
        <button
          onClick={toggleCollapse}
          className="flex h-10 w-7 items-center justify-center text-text-muted hover:bg-bg-subtle hover:text-text"
          title={t('settings.sidebarExpand')}
        >
          <ChevronRightIcon width={14} height={14} />
        </button>
        <div className="min-h-0 flex-1" />
        {/* AI status indicator */}
        <button
          onClick={onOpenSettings}
          className="border-t border-border p-1.5 hover:bg-bg-subtle"
        >
          <span
            className={`block h-2 w-2 rounded-full ${
              aiReady ? 'bg-green-500' : 'bg-zinc-400'
            }`}
          />
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-surface">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('menu.file')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void handleNewFile()}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text"
            title={t('tree.newFile')}
          >
            <PlusIcon />
          </button>
          <button
            onClick={toggleCollapse}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text"
            title={t('settings.sidebarCollapsed')}
          >
            <ChevronLeftIcon width={14} height={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-1">
        {tree && tree.children && tree.children.length > 0 ? (
          <FileTreeView node={tree} />
        ) : (
          <button
            onClick={() => void handleNewFile()}
            className="px-2 py-4 text-left text-xs text-text-muted hover:text-text"
          >
            {t('tree.empty')}
          </button>
        )}
      </div>

      {/* AI status footer */}
      <button
        onClick={onOpenSettings}
        className="border-t border-border px-3 py-2 text-left text-xs hover:bg-bg-subtle"
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              aiReady ? 'bg-green-500' : 'bg-zinc-400'
            }`}
          />
          <span className={aiReady ? 'text-text' : 'text-text-muted'}>
            {config.ai.currentModelId
              ? config.ai.models.find((m) => m.id === config.ai.currentModelId)?.name
              : t('ai.notConfigured')}
          </span>
        </div>
      </button>
    </aside>
  )
}

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileNode } from '@shared/types'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore } from '../store/workspace'
import { watchTree, createFolder } from '../services/fileOps'
import { insertNode, findNode } from '../services/treeOps'
import FileTreeView, { flattenTree } from './FileTree/FileTreeView'
import NewFileInput from './FileTree/NewFileInput'
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon } from './ui/icons'
import { useContextMenu } from './ui/ContextMenu'
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
  const root = useWorkspaceRoot()
  const setPendingRename = useWorkspaceStore((s) => s.setPendingRename)
  const pendingNewFileDir = useWorkspaceStore((s) => s.pendingNewFileDir)
  const setPendingNewFile = useWorkspaceStore((s) => s.setPendingNewFile)
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths)
  const lastClickedPath = useWorkspaceStore((s) => s.lastClickedPath)
  const collapsed = config.app.sidebarCollapsed
  const { open: openContextMenu } = useContextMenu()

  // Pre-compute flattened path list for Shift-range selection.
  const flatPaths = useMemo(() => (tree ? flattenTree(tree) : []), [tree])

  // Subscribe to workspace tree changes on mount.
  useEffect(() => {
    const unsub = watchTree((next) => {
      const state = useWorkspaceStore.getState()
      // A poll can race an optimistic create-folder: if the fresh tree is
      // missing the node currently being renamed, re-insert it from the
      // previous tree so the RenameInput doesn't unmount mid-typing.
      // (Self-corrects once the next poll sees the folder on disk.)
      if (state.pendingRenamePath && state.tree) {
        const pending = findNode(state.tree, state.pendingRenamePath)
        if (pending && !findNode(next, state.pendingRenamePath)) {
          const parentDir = pending.path.slice(0, pending.path.length - pending.name.length)
          state.setTree(insertNode(next, parentDir, pending))
          return
        }
      }
      setTree(next)
    })
    return unsub
  }, [setTree])

  const handleNewFile = useCallback((): void => {
    if (!root) return
    setPendingNewFile(root)
  }, [root, setPendingNewFile])

  const handleNewFolder = async (): Promise<void> => {
    if (!root) return
    const path = await createFolder(root, t('tree.newFolderName'))
    const name = path.split('/').pop() ?? ''
    const state = useWorkspaceStore.getState()
    if (state.tree) {
      const newNode: FileNode = {
        path,
        name,
        kind: 'folder',
        children: []
      }
      state.setTree(insertNode(state.tree, root, newNode))
    }
    setPendingRename(path)
  }

  const handleOpenFolder = async (): Promise<void> => {
    const chosen = await window.api.selectWorkspace()
    if (!chosen) return
    const result = await window.api.changeWorkspace(chosen)
    if (!result.success) {
      console.error('Failed to change workspace:', result.error)
    }
  }

  const toggleCollapse = (): void => {
    void patchConfig({ app: { sidebarCollapsed: !collapsed } })
  }

  // Tree container ref for focus management + F2 rename shortcut
  const treeContainerRef = useRef<HTMLDivElement>(null)

  // F2 triggers rename on the last-clicked (or single-selected) tree node
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        const target = lastClickedPath ?? selectedPaths[0]
        if (target) setPendingRename(target)
      }
    },
    [lastClickedPath, selectedPaths, setPendingRename]
  )

  // Right-click on blank area of the tree → New File / New Folder
  const handleTreeContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const container = treeContainerRef.current
      if (!container) return

      const target = e.target as HTMLElement

      // Only handle clicks within our container
      if (!container.contains(target)) return

      // If the click landed on or inside a button (tree node row), skip — the
      // node's own FileTreeNodeMenu handles it.
      if (target.closest('button')) return

      openContextMenu(e, [
        {
          id: 'blank-new-file',
          label: t('tree.newFile'),
          onClick: () => void handleNewFile()
        },
        {
          id: 'blank-new-folder',
          label: t('tree.newFolder'),
          onClick: () => void handleNewFolder()
        }
      ])
    },
    [openContextMenu, t, root]
  )

  // When collapsed, render a thin strip with an expand button only.
  if (collapsed) {
    return (
      <aside className="flex shrink-0 flex-col border-r border-border bg-bg-surface overflow-hidden">
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
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-surface overflow-hidden">
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
            onClick={() => void handleNewFolder()}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text"
            title={t('tree.newFolder')}
          >
            <FolderIcon width={14} height={14} />
          </button>
          <button
            onClick={() => void handleOpenFolder()}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text"
            title={t('tree.openFolder')}
          >
            <FolderOpenIcon width={14} height={14} />
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

      <div
        ref={treeContainerRef}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        onContextMenu={handleTreeContextMenu}
        className="min-h-0 flex-1 overflow-auto px-1 pb-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        {!root ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <button
              onClick={() => void handleOpenFolder()}
              className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-text-muted hover:border-accent hover:text-accent transition-colors"
            >
              <FolderOpenIcon width={28} height={28} />
              <div>
                <div className="text-sm font-medium">{t('tree.noWorkspace')}</div>
                <div className="text-xs text-text-muted mt-1">{t('tree.noWorkspaceHint')}</div>
              </div>
            </button>
          </div>
        ) : (
          <>
            {pendingNewFileDir === root && <NewFileInput dir={root} />}
            {tree && tree.children && tree.children.length > 0 ? (
              <FileTreeView node={tree} flatPaths={flatPaths} />
            ) : pendingNewFileDir !== root ? (
              <button
                onClick={() => void handleNewFile()}
                className="px-2 py-4 text-left text-xs text-text-muted hover:text-text"
              >
                {t('tree.empty')}
              </button>
            ) : null}
          </>
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

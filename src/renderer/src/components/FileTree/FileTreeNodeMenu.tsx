import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileNode } from '@shared/types'
import { useContextMenu, type MenuItemDef } from '../ui/ContextMenu'
import { useWorkspaceStore } from '../../store/workspace'
import {
  renameNode,
  deleteNode,
  deleteNodes,
  copyNode,
  showInFolder,
  readFileSync
} from '../../services/fileOps'
import { renameNodeInTree, removeNodeFromTree } from '../../services/treeOps'

interface Props {
  node: FileNode
  children: ReactNode
  /** Whether this node is part of an active multi-select. */
  isSelected?: boolean
  /** Called after creating a new file or folder inside this node's parent directory,
   *  so the containing FolderRows can auto-expand if it was collapsed. */
  onCreatedInFolder?: () => void
}

/**
 * Wraps a tree row and wires up its right-click menu: New markdown, New folder,
 * Copy, Reveal in File Manager, Rename, Delete. When multi-select is active,
 * it shows bulk copy/delete options. Operations refresh the tree via
 * the workspace store (which is kept in sync by the FS watcher).
 */
export default function FileTreeNodeMenu({ node, children, isSelected, onCreatedInFolder }: Props): JSX.Element {
  const { t } = useTranslation()
  const { open } = useContextMenu()
  const openFile = useWorkspaceStore((s) => s.openFile)
  const renameTab = useWorkspaceStore((s) => s.renameTab)
  const renameTabsUnder = useWorkspaceStore((s) => s.renameTabsUnder)
  const dropTabsUnder = useWorkspaceStore((s) => s.dropTabsUnder)
  const pendingRenamePath = useWorkspaceStore((s) => s.pendingRenamePath)
  const setPendingRename = useWorkspaceStore((s) => s.setPendingRename)
  const clearPendingRename = useWorkspaceStore((s) => s.clearPendingRename)
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths)
  const setSelectedPaths = useWorkspaceStore((s) => s.setSelectedPaths)
  const setLastClickedPath = useWorkspaceStore((s) => s.setLastClickedPath)
  const setMarker = useWorkspaceStore((s) => s.setMarker)
  const [renaming, setRenaming] = useState(false)

  const parentDir = node.kind === 'folder' ? node.path : node.path.slice(0, node.path.length - node.name.length)

  /** When right-click opens the menu inside a multi-select, keep the selection intact. */
  const inMultiSelect = isSelected && selectedPaths.length > 1
  const multiPaths = inMultiSelect ? selectedPaths : [node.path]

  const handleNewFile = (): void => {
    onCreatedInFolder?.()
    const dir = node.kind === 'folder' ? node.path : parentDir
    // Don't create the file yet — show an empty input; it is created on commit.
    useWorkspaceStore.getState().setPendingNewFile(dir, 'file')
  }

  const handleNewFolder = (): void => {
    onCreatedInFolder?.()
    const dir = node.kind === 'folder' ? node.path : parentDir
    useWorkspaceStore.getState().setPendingNewFile(dir, 'folder')
  }

  const handleCopy = async (): Promise<void> => {
    if (inMultiSelect) {
      for (const p of multiPaths) {
        await copyNode(p)
      }
    } else {
      await copyNode(node.path)
    }
  }

  const handleReveal = async (): Promise<void> => {
    await showInFolder(node.path)
  }

  const handlePreview = async (): Promise<void> => {
    try {
      const content = await readFileSync(node.path)
      openFile(node.path, node.name, content, true)
    } catch (err) {
      console.error('Preview failed:', err)
    }
  }

  const handleRename = useCallback(async (newName: string): Promise<void> => {
    const newPath = await renameNode(node.path, newName)
    if (node.kind === 'file') {
      renameTab(node.path, newPath, newName)
    } else {
      // Keep every open tab under the renamed folder pointing at valid paths;
      // otherwise stale tabs would re-create the old path on save.
      renameTabsUnder(node.path, newPath)
    }
    // Optimistic rename: update the in-memory tree immediately.
    const state = useWorkspaceStore.getState()
    if (state.tree) {
      state.setTree(renameNodeInTree(state.tree, node.path, newPath, newName))
    }
  }, [node.path, node.kind, renameTab, renameTabsUnder])

  const handleDelete = async (): Promise<void> => {
    if (inMultiSelect) {
      const ok = window.confirm(t('tree.deleteSelectedConfirm', { count: multiPaths.length }))
      if (!ok) return
      await deleteNodes(multiPaths)
      // Close any open tabs under each deleted path.
      for (const p of multiPaths) {
        dropTabsUnder(p)
      }
      setSelectedPaths([])
      setLastClickedPath(null)
      // Optimistic remove for each deleted node.
      const state = useWorkspaceStore.getState()
      if (state.tree) {
        let next = state.tree
        for (const p of multiPaths) {
          const updated = removeNodeFromTree(next, p)
          if (updated) next = updated
        }
        state.setTree(next)
      }
    } else {
      const ok = window.confirm(t('tree.deleteConfirm', { name: node.name }))
      if (!ok) return
      await deleteNode(node.path)
      // Close any open tabs under this node (file itself, or folder subtree).
      dropTabsUnder(node.path)
      // Optimistic remove
      const state = useWorkspaceStore.getState()
      if (state.tree) {
        const updated = removeNodeFromTree(state.tree, node.path)
        if (updated) state.setTree(updated)
      }
    }
  }

  const buildItems = (): MenuItemDef[] => {
    const items: MenuItemDef[] = []

    // New file/folder — only for single-select on folders.
    if (!inMultiSelect && node.kind === 'folder') {
      items.push({ id: 'new-file', label: t('tree.newFile'), onClick: handleNewFile })
      items.push({
        id: 'new-folder',
        label: t('tree.newFolder'),
        onClick: handleNewFolder,
        separatorAfter: true
      })
    }

    if (!inMultiSelect && node.kind === 'file') {
      items.push({
        id: 'mark',
        label: t('tree.mark'),
        onClick: () => {},
        submenu: [
          {
            id: 'red',
            label: t('tree.colors.red'),
            swatch: 'bg-red-500',
            onClick: () => setMarker(node.path, 'red')
          },
          {
            id: 'orange',
            label: t('tree.colors.orange'),
            swatch: 'bg-orange-500',
            onClick: () => setMarker(node.path, 'orange')
          },
          {
            id: 'yellow',
            label: t('tree.colors.yellow'),
            swatch: 'bg-yellow-400',
            onClick: () => setMarker(node.path, 'yellow')
          },
          {
            id: 'green',
            label: t('tree.colors.green'),
            swatch: 'bg-green-500',
            onClick: () => setMarker(node.path, 'green')
          }
        ]
      })
    }

    // Copy
    if (inMultiSelect) {
      items.push({
        id: 'copy-multi',
        label: t('tree.copySelected', { count: multiPaths.length }),
        onClick: handleCopy
      })
    } else {
      items.push({ id: 'copy', label: t('tree.copy'), onClick: handleCopy })
    }

    // Reveal — only for single-select
    if (!inMultiSelect) {
      items.push({
        id: 'reveal',
        label: t('tree.showInFolder'),
        onClick: handleReveal,
        separatorAfter: true
      })
    } else {
      // Add separator after copy for multi-select too
      items[items.length - 1].separatorAfter = true
    }

    // Preview — only for single-select files
    if (!inMultiSelect && node.kind === 'file') {
      items.push({
        id: 'preview',
        label: t('tree.preview'),
        onClick: handlePreview,
        separatorAfter: true
      })
    }

    // Rename — only for single-select. Going through pendingRenamePath (rather
    // than setting renaming directly) makes Workspace's editor auto-focus skip
    // the rename input, and lets commit/cancel restore focus afterwards.
    if (!inMultiSelect) {
      items.push({
        id: 'rename',
        label: t('tree.rename'),
        onClick: () => setPendingRename(node.path)
      })
    }

    // Delete
    if (inMultiSelect) {
      items.push({
        id: 'delete-multi',
        label: t('tree.deleteSelected', { count: multiPaths.length }),
        onClick: handleDelete,
        danger: true
      })
    } else {
      items.push({ id: 'delete', label: t('tree.delete'), onClick: handleDelete, danger: true })
    }

    return items
  }

  // Auto-enter rename mode when this node was just created
  useEffect(() => {
    if (pendingRenamePath === node.path) {
      // Don't clear pendingRenamePath here — keep it set so the editor
      // auto-focus guard stays active until the user commits or cancels.
      // Clearing it too early creates a race window where the RenameInput
      // can lose focus before it ever gains it (especially with polling).
      setRenaming(true)
    }
  }, [pendingRenamePath, node.path])

  // Stable callbacks for RenameInput to avoid re-renders from polling tree updates
  const handleRenameCommit = useCallback(
    async (name: string) => {
      setRenaming(false)
      clearPendingRename()
      if (name && name !== node.name) {
        try {
          await handleRename(name)
        } catch (err) {
          console.error('Rename failed:', err)
          // Re-enter rename so the user can correct the name (e.g. invalid
          // characters on Windows) instead of the row silently reverting.
          setRenaming(true)
        }
      }
    },
    [node.name, handleRename, clearPendingRename]
  )
  const handleRenameCancel = useCallback(() => {
    setRenaming(false)
    clearPendingRename()
  }, [clearPendingRename])

  if (renaming) {
    return (
      <RenameInput
        initial={node.name}
        onCommit={handleRenameCommit}
        onCancel={handleRenameCancel}
      />
    )
  }

  return (
    <div onContextMenu={(e) => open(e, buildItems())} className="contents">
      {children}
    </div>
  )
}

function RenameInput({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const [value, setValue] = useState(initial)

  // Track mount state so we don't commit on an unmount-triggered blur.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Focus the input and select the filename portion.
  // Synchronous focus() is safe now because the editor's auto-focus effect
  // checks pendingRenamePath (which stays set until commit/cancel) and skips
  // focusing the editor when a rename is active.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    // Defer the selection so the browser's native focus machinery has time
    // to settle — avoids races on Windows where synchronous selection can
    // lose the cursor.
    const timer = setTimeout(() => {
      if (!mountedRef.current) return
      if (initial.endsWith('.md')) {
        const baseLen = initial.length - 3 // length of ".md"
        input.setSelectionRange(0, baseLen)
      } else {
        input.select()
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [initial])

  const handleBlur = (): void => {
    // Only commit if we're still mounted — prevents spurious commits when
    // React tears down the input due to a parent re-render stealing focus.
    if (mountedRef.current) {
      onCommit(value)
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      className="w-full rounded border border-accent bg-bg-base px-1.5 py-1 text-[13px] outline-none"
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Ignore keys used by IME composition (pinyin etc.): Enter confirms a
        // candidate, Escape cancels it — neither should commit or cancel the
        // rename mid-composition.
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(value)
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileNode } from '@shared/types'
import { useContextMenu, type MenuItemDef } from '../ui/ContextMenu'
import { useWorkspaceStore } from '../../store/workspace'
import {
  createFile,
  createFolder,
  renameNode,
  deleteNode,
  copyNode,
  showInFolder,
  readFileSync
} from '../../services/fileOps'

interface Props {
  node: FileNode
  children: ReactNode
}

/**
 * Wraps a tree row and wires up its right-click menu: New markdown, New folder,
 * Copy, Reveal in File Manager, Rename, Delete. Operations refresh the tree via
 * the workspace store (which is kept in sync by the FS watcher).
 */
export default function FileTreeNodeMenu({ node, children }: Props): JSX.Element {
  const { t } = useTranslation()
  const { open } = useContextMenu()
  const openFile = useWorkspaceStore((s) => s.openFile)
  const renameTab = useWorkspaceStore((s) => s.renameTab)
  const dropTabsUnder = useWorkspaceStore((s) => s.dropTabsUnder)
  const pendingRenamePath = useWorkspaceStore((s) => s.pendingRenamePath)
  const setPendingRename = useWorkspaceStore((s) => s.setPendingRename)
  const clearPendingRename = useWorkspaceStore((s) => s.clearPendingRename)
  const [renaming, setRenaming] = useState(false)

  const parentDir = node.kind === 'folder' ? node.path : node.path.slice(0, node.path.length - node.name.length)

  const handleNewFile = async (): Promise<void> => {
    const dir = node.kind === 'folder' ? node.path : parentDir
    const path = await createFile(dir, t('tree.newFileName'))
    const content = await readFileSync(path)
    openFile(path, path.split('/').pop() ?? '', content)
    setPendingRename(path)
  }

  const handleNewFolder = async (): Promise<void> => {
    const dir = node.kind === 'folder' ? node.path : parentDir
    const path = await createFolder(dir, t('tree.newFolderName'))
    setPendingRename(path)
  }

  const handleCopy = async (): Promise<void> => {
    await copyNode(node.path)
  }

  const handleReveal = async (): Promise<void> => {
    await showInFolder(node.path)
  }

  const handleRename = async (newName: string): Promise<void> => {
    const newPath = await renameNode(node.path, newName)
    if (node.kind === 'file') {
      renameTab(node.path, newPath, newName)
    }
  }

  const handleDelete = async (): Promise<void> => {
    const ok = window.confirm(t('tree.deleteConfirm', { name: node.name }))
    if (!ok) return
    await deleteNode(node.path)
    // Close any open tabs under this node (file itself, or folder subtree).
    dropTabsUnder(node.path)
  }

  const buildItems = (): MenuItemDef[] => {
    const items: MenuItemDef[] = []
    if (node.kind === 'folder') {
      items.push({ id: 'new-file', label: t('tree.newFile'), onClick: handleNewFile })
      items.push({
        id: 'new-folder',
        label: t('tree.newFolder'),
        onClick: handleNewFolder,
        separatorAfter: true
      })
    }
    items.push({ id: 'copy', label: t('tree.copy'), onClick: handleCopy })
    items.push({
      id: 'reveal',
      label: t('tree.showInFolder'),
      onClick: handleReveal,
      separatorAfter: true
    })
    items.push({ id: 'rename', label: t('tree.rename'), onClick: () => setRenaming(true) })
    items.push({ id: 'delete', label: t('tree.delete'), onClick: handleDelete, danger: true })
    return items
  }

  // Auto-enter rename mode when this node was just created
  useEffect(() => {
    if (pendingRenamePath === node.path) {
      clearPendingRename()
      setRenaming(true)
    }
  }, [pendingRenamePath, node.path, clearPendingRename])

  if (renaming) {
    return (
      <RenameInput
        initial={node.name}
        onCommit={(name) => {
          setRenaming(false)
          if (name && name !== node.name) void handleRename(name)
        }}
        onCancel={() => setRenaming(false)}
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
  const [value, setValue] = useState(initial)

  // When initial ends with ".md", select the filename part (before the dot)
  // so the user can type a new name immediately without deleting the extension.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    if (initial.endsWith('.md')) {
      const baseLen = initial.length - 3 // length of ".md"
      input.setSelectionRange(0, baseLen)
    } else {
      input.select()
    }
  }, [initial])

  return (
    <input
      ref={inputRef}
      autoFocus
      value={value}
      className="w-full rounded border border-accent bg-bg-base px-1.5 py-1 text-[13px] outline-none"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value)
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { FileNode } from '@shared/types'
import { useWorkspaceStore } from '../../store/workspace'
import {
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  MarkdownIcon
} from '../ui/icons'
import FileTreeNodeMenu from './FileTreeNodeMenu'
import NewFileInput from './NewFileInput'
import { readFileSync } from '../../services/fileOps'
import { useWorkspaceRoot } from '../../hooks/useWorkspaceRoot'

interface FileTreeDragContextValue {
  draggedPath: string | null
  draggedParentPath: string | null
  dropTargetPath: string | null
  dropBefore: boolean
  start: (path: string, parentPath: string) => void
  setTarget: (path: string, before: boolean) => void
  clearTarget: (path: string) => void
  drop: (path: string, before: boolean) => void
  end: () => void
  consumeClick: (path: string) => boolean
}

const FileTreeDragContext = createContext<FileTreeDragContextValue | null>(null)

export function FileTreeDragProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const reorderTree = useWorkspaceStore((s) => s.reorderTree)
  const [drag, setDrag] = useState<{ path: string; parentPath: string } | null>(null)
  const [target, setTargetState] = useState<{ path: string; before: boolean } | null>(null)
  const suppressedClickPath = useRef<string | null>(null)

  const end = useCallback(() => {
    setDrag(null)
    setTargetState(null)
  }, [])

  const drop = useCallback(
    (targetPath: string, before: boolean): void => {
      const current = drag
      if (!current || current.path === targetPath) {
        end()
        return
      }
      reorderTree(current.path, targetPath, before)
      suppressedClickPath.current = current.path
      end()
    },
    [drag, end, reorderTree]
  )

  return (
    <FileTreeDragContext.Provider
      value={{
        draggedPath: drag?.path ?? null,
        draggedParentPath: drag?.parentPath ?? null,
        dropTargetPath: target?.path ?? null,
        dropBefore: target?.before ?? true,
        start: (path, parentPath) => {
          suppressedClickPath.current = null
          setDrag({ path, parentPath })
          setTargetState(null)
        },
        setTarget: (path, before) => setTargetState({ path, before }),
        clearTarget: (path) =>
          setTargetState((current) => (current?.path === path ? null : current)),
        drop,
        end,
        consumeClick: (path) => {
          if (suppressedClickPath.current !== path) return false
          suppressedClickPath.current = null
          return true
        }
      }}
    >
      {children}
    </FileTreeDragContext.Provider>
  )
}

function useTreeDrag(node: FileNode, enabled: boolean): {
  draggable: boolean
  dragging: boolean
  dropClassName: string
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragOver: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragLeave: (e: React.DragEvent<HTMLButtonElement>) => void
  onDrop: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
  consumeClick: (path: string) => boolean
} {
  const workspaceRoot = useWorkspaceRoot()
  const context = useContext(FileTreeDragContext)
  if (!context) throw new Error('useTreeDrag must be used inside FileTreeDragProvider')

  const parentPath = getParentPath(node, workspaceRoot)
  const draggable = enabled && parentPath !== null
  const canDrop =
    parentPath !== null &&
    context.draggedPath !== null &&
    context.draggedPath !== node.path &&
    context.draggedParentPath === parentPath

  const onDragStart = useCallback(
    (e: React.DragEvent<HTMLButtonElement>): void => {
      if (!draggable || !parentPath) return
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', node.path)
      context.start(node.path, parentPath)
    },
    [context, draggable, node.path, parentPath]
  )

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLButtonElement>): void => {
      if (!canDrop) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      context.setTarget(node.path, e.clientY < rect.top + rect.height / 2)
    },
    [canDrop, context, node.path]
  )

  const onDragLeave = useCallback(
    (e: React.DragEvent<HTMLButtonElement>): void => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        context.clearTarget(node.path)
      }
    },
    [context, node.path]
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>): void => {
      if (!canDrop) return
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      context.drop(node.path, e.clientY < rect.top + rect.height / 2)
    },
    [canDrop, context, node.path]
  )

  const dropClassName =
    context.dropTargetPath === node.path
      ? context.dropBefore
        ? 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent'
        : 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
      : ''

  return {
    draggable,
    dragging: context.draggedPath === node.path,
    dropClassName,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd: context.end,
    consumeClick: context.consumeClick
  }
}

function getParentPath(node: FileNode, workspaceRoot: string | null): string | null {
  if (!workspaceRoot || node.path === workspaceRoot) return null
  const prefix = node.path.slice(0, node.path.length - node.name.length)
  return prefix.replace(/[\\/]$/, '') || null
}

interface FileTreeViewProps {
  node: FileNode
  /** Flat list of all visible paths in the tree (for Shift-range selection). */
  flatPaths?: string[]
}

export default function FileTreeView({ node, flatPaths }: FileTreeViewProps): JSX.Element {
  if (node.kind === 'file') {
    return <FileRow node={node} flatPaths={flatPaths} />
  }
  return <FolderRows node={node} flatPaths={flatPaths} />
}

/* ------------------------------ file ------------------------------ */

function FileRow({
  node,
  flatPaths
}: {
  node: FileNode
  flatPaths?: string[]
}): JSX.Element {
  const activePath = useWorkspaceStore((s) => s.activePath)
  const openFile = useWorkspaceStore((s) => s.openFile)
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths)
  const lastClickedPath = useWorkspaceStore((s) => s.lastClickedPath)
  const setSelectedPaths = useWorkspaceStore((s) => s.setSelectedPaths)
  const setLastClickedPath = useWorkspaceStore((s) => s.setLastClickedPath)
  const marker = useWorkspaceStore((s) => s.markers[node.path])
  const isActive = activePath === node.path
  const isSelected = selectedPaths.includes(node.path)
  const isMd = node.name.endsWith('.md')
  const drag = useTreeDrag(node, true)

  const handleClick = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      if (drag.consumeClick(node.path)) return
      if (e.shiftKey && flatPaths && lastClickedPath) {
        e.preventDefault()
        const from = flatPaths.indexOf(lastClickedPath)
        const to = flatPaths.indexOf(node.path)
        if (from !== -1 && to !== -1) {
          const start = Math.min(from, to)
          const end = Math.max(from, to)
          setSelectedPaths(flatPaths.slice(start, end + 1))
        } else {
          setSelectedPaths([node.path])
        }
        return
      }
      setSelectedPaths([node.path])
      setLastClickedPath(node.path)
      const content = await readFileSync(node.path)
      // A slower read must not reactivate an older click after the user has
      // already selected another row.
      if (useWorkspaceStore.getState().selectedPaths[0] !== node.path) return
      openFile(node.path, node.name, content)
    },
    [drag, node.path, node.name, flatPaths, lastClickedPath, openFile, setSelectedPaths, setLastClickedPath]
  )

  return (
    <FileTreeNodeMenu node={node} isSelected={isSelected}>
      <button
        onClick={handleClick}
        draggable={drag.draggable}
        onDragStart={drag.onDragStart}
        onDragOver={drag.onDragOver}
        onDragLeave={drag.onDragLeave}
        onDrop={drag.onDrop}
        onDragEnd={drag.onDragEnd}
        aria-current={isActive ? 'page' : undefined}
        className={`group relative flex w-full items-center rounded py-0.5 text-left text-[13px] ${drag.dropClassName} ${
          isActive
            ? 'bg-accent-soft text-accent font-medium ring-1 ring-inset ring-accent/30'
            : isSelected
              ? 'bg-accent-soft/50 text-text'
              : 'text-text hover:bg-bg-subtle'
        } ${drag.dragging ? 'opacity-50' : ''}`}
      >
        {isMd ? (
          <MarkdownIcon className="mr-1 shrink-0 opacity-70" width={14} height={14} />
        ) : (
          <FileIcon className="mr-1 shrink-0 opacity-70" width={14} height={14} />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {marker && (
          <span
            aria-label={marker}
            className={`ml-2 h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/20 ${
              marker === 'red'
                ? 'bg-red-500'
                : marker === 'orange'
                  ? 'bg-orange-500'
                  : marker === 'yellow'
                    ? 'bg-yellow-400'
                    : 'bg-green-500'
            }`}
          />
        )}
      </button>
    </FileTreeNodeMenu>
  )
}

/* ----------------------------- folder ----------------------------- */

function FolderRows({
  node,
  flatPaths
}: {
  node: FileNode
  flatPaths?: string[]
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths)
  const lastClickedPath = useWorkspaceStore((s) => s.lastClickedPath)
  const setSelectedPaths = useWorkspaceStore((s) => s.setSelectedPaths)
  const setLastClickedPath = useWorkspaceStore((s) => s.setLastClickedPath)
  const pendingNewFileDir = useWorkspaceStore((s) => s.pendingNewFileDir)
  const pendingNewFileKind = useWorkspaceStore((s) => s.pendingNewFileKind)
  const workspaceRoot = useWorkspaceRoot()
  const isSelected = selectedPaths.includes(node.path)
  const children = node.children ?? []
  // The Sidebar renders the new-file input for the workspace root itself;
  // folders render their own input here. Rendering both would mount two
  // inputs that fight over focus (each blur cancels the other).
  const isRoot = node.path === workspaceRoot
  const isActive = activePath === node.path
  const drag = useTreeDrag(node, !isRoot)

  const handleToggle = useCallback(
    (e: React.MouseEvent): void => {
      if (e.shiftKey && flatPaths && lastClickedPath) {
        e.preventDefault()
        const from = flatPaths.indexOf(lastClickedPath)
        const to = flatPaths.indexOf(node.path)
        if (from !== -1 && to !== -1) {
          const start = Math.min(from, to)
          const end = Math.max(from, to)
          setSelectedPaths(flatPaths.slice(start, end + 1))
        } else {
          setSelectedPaths([node.path])
        }
        return
      }
      setSelectedPaths([node.path])
      setLastClickedPath(node.path)
      setOpen((o) => !o)
    },
    [node.path, flatPaths, lastClickedPath, setSelectedPaths, setLastClickedPath]
  )

  return (
    <div>
      <FileTreeNodeMenu node={node} isSelected={isSelected} onCreatedInFolder={() => setOpen(true)}>
        <button
          onClick={handleToggle}
          draggable={drag.draggable}
          onDragStart={drag.onDragStart}
          onDragOver={drag.onDragOver}
          onDragLeave={drag.onDragLeave}
          onDrop={drag.onDrop}
          onDragEnd={drag.onDragEnd}
          aria-current={isActive ? 'page' : undefined}
          className={`relative flex w-full items-center rounded py-0.5 text-left text-[13px] ${drag.dropClassName} ${
            isActive
              ? 'bg-accent-soft text-accent font-medium ring-1 ring-inset ring-accent/30'
              : isSelected
                ? 'bg-accent-soft/50 text-text'
                : 'text-text hover:bg-bg-subtle'
          } ${drag.dragging ? 'opacity-50' : ''}`}
        >
          {/* Chevron for expand/collapse */}
          <span className="mr-0.5 shrink-0 opacity-60">
            {open ? (
              <ChevronDownIcon width={12} height={12} />
            ) : (
              <ChevronRightIcon width={12} height={12} />
            )}
          </span>
          {open ? (
            <FolderOpenIcon className="mr-1 shrink-0 opacity-80" width={14} height={14} />
          ) : (
            <FolderIcon className="mr-1 shrink-0 opacity-80" width={14} height={14} />
          )}
          <span className="truncate font-medium">{node.name}</span>
        </button>
      </FileTreeNodeMenu>

      {open && (children.length > 0 || pendingNewFileDir === node.path) && (
        <div className="ml-[7px] border-l border-black/10 dark:border-white/10 pl-2">
          {children.map((child) => (
            <FileTreeView key={child.path} node={child} flatPaths={flatPaths} />
          ))}
          {pendingNewFileDir === node.path && !isRoot && (
            <NewFileInput dir={node.path} kind={pendingNewFileKind} />
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Flatten helper                                                     */
/* ------------------------------------------------------------------ */

/** Flatten a FileNode tree into an ordered list of paths. */
export function flattenTree(node: FileNode): string[] {
  const paths: string[] = [node.path]
  if (node.children) {
    for (const child of node.children) {
      paths.push(...flattenTree(child))
    }
  }
  return paths
}

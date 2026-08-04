import { useState, useCallback } from 'react'
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
import { useWorkspaceRoot } from '../../services/workspaceRoot'

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
  const isActive = activePath === node.path
  const isSelected = selectedPaths.includes(node.path)
  const isMd = node.name.endsWith('.md')

  const handleClick = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
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
      openFile(node.path, node.name, content)
    },
    [node.path, node.name, flatPaths, lastClickedPath, openFile, setSelectedPaths, setLastClickedPath]
  )

  return (
    <FileTreeNodeMenu node={node} isSelected={isSelected}>
      <button
        onClick={handleClick}
        className={`group flex w-full items-center rounded py-0.5 text-left text-[13px] ${
          isSelected
            ? 'bg-accent-soft/70 text-accent'
            : isActive
              ? 'bg-accent-soft text-accent'
              : 'text-text hover:bg-bg-subtle'
        }`}
      >
        {isMd ? (
          <MarkdownIcon className="mr-1 shrink-0 opacity-70" width={14} height={14} />
        ) : (
          <FileIcon className="mr-1 shrink-0 opacity-70" width={14} height={14} />
        )}
        <span className="truncate">{node.name}</span>
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
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths)
  const lastClickedPath = useWorkspaceStore((s) => s.lastClickedPath)
  const setSelectedPaths = useWorkspaceStore((s) => s.setSelectedPaths)
  const setLastClickedPath = useWorkspaceStore((s) => s.setLastClickedPath)
  const pendingNewFileDir = useWorkspaceStore((s) => s.pendingNewFileDir)
  const workspaceRoot = useWorkspaceRoot()
  const isSelected = selectedPaths.includes(node.path)
  const children = node.children ?? []
  // The Sidebar renders the new-file input for the workspace root itself;
  // folders render their own input here. Rendering both would mount two
  // inputs that fight over focus (each blur cancels the other).
  const isRoot = node.path === workspaceRoot

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
          className={`flex w-full items-center rounded py-0.5 text-left text-[13px] ${
            isSelected ? 'bg-accent-soft/70 text-accent' : 'text-text hover:bg-bg-subtle'
          }`}
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
          {pendingNewFileDir === node.path && !isRoot && <NewFileInput dir={node.path} />}
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

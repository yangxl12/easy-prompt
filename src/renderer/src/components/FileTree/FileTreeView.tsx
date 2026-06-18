import { useState } from 'react'
import type { FileNode } from '@shared/types'
import { useWorkspaceStore } from '../../store/workspace'
import { FileIcon, FolderIcon, FolderOpenIcon } from '../ui/icons'
import FileTreeNodeMenu from './FileTreeNodeMenu'
import { readFileSync } from '../../services/fileOps'

interface FileTreeViewProps {
  node: FileNode
  /** Depth for indentation. */
  depth?: number
}

export default function FileTreeView({ node, depth = 0 }: FileTreeViewProps): JSX.Element {
  if (node.kind === 'file') {
    return <FileRow node={node} depth={depth} />
  }
  return <FolderRows node={node} depth={depth} />
}

/* ------------------------------ file ------------------------------ */
function FileRow({ node, depth }: { node: FileNode; depth: number }): JSX.Element {
  const activePath = useWorkspaceStore((s) => s.activePath)
  const openFile = useWorkspaceStore((s) => s.openFile)
  const isActive = activePath === node.path

  const handleOpen = async (): Promise<void> => {
    const content = await readFileSync(node.path)
    openFile(node.path, node.name, content)
  }

  return (
    <FileTreeNodeMenu node={node}>
      <button
        onClick={() => void handleOpen()}
        className={`group flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] ${
          isActive ? 'bg-accent-soft text-accent' : 'text-text hover:bg-bg-subtle'
        }`}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        <FileIcon className="shrink-0 opacity-70" />
        <span className="truncate">{node.name}</span>
      </button>
    </FileTreeNodeMenu>
  )
}

/* ----------------------------- folder ----------------------------- */
function FolderRows({ node, depth }: { node: FileNode; depth: number }): JSX.Element {
  const [open, setOpen] = useState(true)

  return (
    <div>
      <FileTreeNodeMenu node={node}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] text-text hover:bg-bg-subtle"
          style={{ paddingLeft: depth * 12 + 6 }}
        >
          {open ? <FolderOpenIcon className="shrink-0 opacity-80" /> : <FolderIcon className="shrink-0 opacity-80" />}
          <span className="truncate font-medium">{node.name}</span>
        </button>
      </FileTreeNodeMenu>
      {open &&
        node.children?.map((child) => (
          <FileTreeView key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  )
}

import { useCallback } from 'react'
import type { FileNodeKind } from '@shared/types'
import { useWorkspaceStore } from '../store/workspace'
import {
  createFile,
  createFolder,
  deleteNode as deleteNodeFs,
  deleteNodes as deleteNodesFs,
  renameNode as renameNodeFs
} from '../services/fileOps'
import { insertNode, renameNodeInTree, removeNodeFromTree } from '../services/treeOps'
import { baseNameAny } from '../services/pathUtils'

/**
 * File-tree mutations with optimistic updates. Each action performs the disk
 * operation, syncs open tabs to the new paths, and rewrites the in-memory tree
 * immediately — the 1.5s watcher poll then confirms or corrects the result.
 *
 * This is the single home for the create/rename/delete orchestration so the
 * tree components don't each re-implement it (previously duplicated across
 * NewFileInput and FileTreeNodeMenu).
 */
export function useFileTreeActions(): {
  /** Create a file/folder on disk and insert it into the in-memory tree. */
  createNode: (
    dir: string,
    name: string,
    kind: 'file' | 'folder'
  ) => Promise<{ path: string; name: string }>
  /** Rename on disk, sync open tabs, and rename in the in-memory tree. */
  renameNode: (
    node: { path: string; name: string; kind: FileNodeKind },
    newName: string
  ) => Promise<string>
  /**
   * Delete nodes on disk (recycle bin), close tabs under each path, and
   * remove them from the in-memory tree. Multi-select selection cleanup is
   * left to the caller (UI concern).
   */
  deleteNodes: (paths: string[]) => Promise<void>
} {
  const createNode = useCallback(
    async (dir: string, name: string, kind: 'file' | 'folder') => {
      const path = kind === 'folder' ? await createFolder(dir, name) : await createFile(dir, name)
      const fileName = baseNameAny(path)
      // Optimistic insert: show the new node immediately; the next watcher
      // poll confirms it.
      const state = useWorkspaceStore.getState()
      if (state.tree) {
        state.setTree(
          insertNode(state.tree, dir, {
            path,
            name: fileName,
            kind
          })
        )
      }
      return { path, name: fileName }
    },
    []
  )

  const renameNode = useCallback(
    async (node: { path: string; name: string; kind: FileNodeKind }, newName: string) => {
      const newPath = await renameNodeFs(node.path, newName)
      const state = useWorkspaceStore.getState()
      if (node.kind === 'file') {
        state.renameTab(node.path, newPath, newName)
      } else {
        // Keep every open tab under the renamed folder pointing at valid paths;
        // otherwise stale tabs would re-create the old path on save.
        state.renameTabsUnder(node.path, newPath)
      }
      // Optimistic rename: update the in-memory tree immediately.
      if (state.tree) {
        state.setTree(renameNodeInTree(state.tree, node.path, newPath, newName))
      }
      return newPath
    },
    []
  )

  const deleteNodes = useCallback(async (paths: string[]) => {
    if (paths.length === 1) {
      await deleteNodeFs(paths[0])
    } else {
      await deleteNodesFs(paths)
    }
    // Close any open tabs under each deleted path (file itself, or folder subtree).
    const state = useWorkspaceStore.getState()
    for (const p of paths) {
      state.dropTabsUnder(p)
    }
    // Optimistic remove for each deleted node.
    if (state.tree) {
      let next = state.tree
      for (const p of paths) {
        const updated = removeNodeFromTree(next, p)
        if (updated) next = updated
      }
      state.setTree(next)
    }
  }, [])

  return { createNode, renameNode, deleteNodes }
}

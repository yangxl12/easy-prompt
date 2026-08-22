import type { StateCreator } from 'zustand'
import type { FileNode } from '@shared/types'
import type { WorkspaceState } from './workspace'
import {
  applyTreeOrder,
  findNode,
  findParentPath,
  mergeTreeOrder,
  moveNodeInTree,
  type TreeOrder
} from '../services/treeOps'
import {
  FILE_MARKER_STORAGE_KEY,
  TREE_ORDER_STORAGE_KEY,
  readLocalPref,
  writeLocalPref
} from '../services/localPrefs'

/** UI-only color markers, persisted separately from user Markdown content. */
export type FileMarker = 'red' | 'orange' | 'yellow' | 'green'

/** The file-tree slice: tree data, persisted ordering/markers, and tree UI state. */
export interface FileTreeSlice {
  tree: FileNode | null
  treeOrder: TreeOrder
  /** UI-only color markers, persisted separately from user Markdown content. */
  markers: Record<string, FileMarker>
  /** Multi-select in the file tree. */
  selectedPaths: string[]
  lastClickedPath: string | null
  /** Path of a newly created node that should enter rename mode on next render. */
  pendingRenamePath: string | null
  /** Directory where a "new markdown" input is shown; the file is only created on commit. */
  pendingNewFileDir: string | null
  pendingNewFileKind: 'file' | 'folder'

  setTree: (tree: FileNode) => void
  /** Reorder direct siblings in the file tree. */
  reorderTree: (sourcePath: string, targetPath: string, before: boolean) => void
  setMarker: (path: string, marker: FileMarker | null) => void
  setSelectedPaths: (paths: string[]) => void
  toggleSelectedPath: (path: string) => void
  setLastClickedPath: (path: string | null) => void
  setPendingRename: (path: string) => void
  clearPendingRename: () => void
  setPendingNewFile: (dir: string, kind?: 'file' | 'folder') => void
  clearPendingNewFile: () => void
}

export const createFileTreeSlice: StateCreator<WorkspaceState, [], [], FileTreeSlice> = (set) => ({
  tree: null,
  treeOrder: readLocalPref<TreeOrder>(TREE_ORDER_STORAGE_KEY, {}),
  markers: readLocalPref<Record<string, FileMarker>>(FILE_MARKER_STORAGE_KEY, {}),

  selectedPaths: [],
  lastClickedPath: null,

  pendingRenamePath: null,
  pendingNewFileDir: null,
  pendingNewFileKind: 'file',

  setTree: (tree) =>
    set((s) => {
      const treeOrder = mergeTreeOrder(s.tree, tree, s.treeOrder)
      writeLocalPref(TREE_ORDER_STORAGE_KEY, treeOrder)
      return { tree: applyTreeOrder(tree, treeOrder), treeOrder }
    }),

  reorderTree: (sourcePath, targetPath, before) =>
    set((s) => {
      if (!s.tree) return s
      const parentPath = findParentPath(s.tree, sourcePath)
      if (!parentPath) return s
      const tree = moveNodeInTree(s.tree, sourcePath, targetPath, before)
      if (!tree) return s
      const parent = findNode(tree, parentPath)
      if (!parent || parent.kind !== 'folder') return s
      const treeOrder: TreeOrder = {
        ...s.treeOrder,
        [parentPath]: (parent.children ?? []).map((child) => child.path)
      }
      writeLocalPref(TREE_ORDER_STORAGE_KEY, treeOrder)
      return { tree, treeOrder }
    }),

  setMarker: (path, marker) =>
    set((s) => {
      const markers = { ...s.markers }
      if (marker) markers[path] = marker
      else delete markers[path]
      writeLocalPref(FILE_MARKER_STORAGE_KEY, markers)
      return { markers }
    }),

  setSelectedPaths: (paths) => set({ selectedPaths: paths }),

  toggleSelectedPath: (path) =>
    set((s) => {
      const set = new Set(s.selectedPaths)
      if (set.has(path)) set.delete(path)
      else set.add(path)
      return { selectedPaths: Array.from(set), lastClickedPath: path }
    }),

  setLastClickedPath: (path) => set({ lastClickedPath: path }),

  setPendingRename: (path) => set({ pendingRenamePath: path }),

  clearPendingRename: () => set({ pendingRenamePath: null }),

  setPendingNewFile: (dir, kind = 'file') =>
    set({ pendingNewFileDir: dir, pendingNewFileKind: kind }),

  clearPendingNewFile: () => set({ pendingNewFileDir: null, pendingNewFileKind: 'file' })
})

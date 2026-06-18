import { create } from 'zustand'
import type { FileNode } from '@shared/types'

/**
 * Per-tab state. `dirtyContent` holds edits not yet written to disk; when set,
 * the preview renders from it instead of the on-disk content.
 */
export interface Tab {
  /** Absolute file path — unique key. */
  path: string
  name: string
  /** Last content loaded/saved from disk. */
  savedContent: string
  /** Unsaved edits, or null when in sync with disk. */
  dirtyContent: string | null
}

interface WorkspaceState {
  tree: FileNode | null
  tabs: Tab[]
  activePath: string | null

  setTree: (tree: FileNode) => void
  openFile: (path: string, name: string, content: string) => void
  closeTab: (path: string) => void
  setActive: (path: string) => void
  /** Mark a tab's on-disk content as updated (e.g. after save or external change). */
  setSaved: (path: string, content: string) => void
  /** Update the dirty (unsaved) content of a tab. */
  edit: (path: string, content: string) => void
  /** Clear dirty flag after a successful save. */
  markClean: (path: string) => void
  /** Rename a tab's path (used after a rename operation). */
  renameTab: (oldPath: string, newPath: string, newName: string) => void
  /** Remove tabs whose paths start with the given prefix (deleted files). */
  dropTabsUnder: (prefix: string) => void
  /** Path of a newly created node that should enter rename mode on next render. */
  pendingRenamePath: string | null
  setPendingRename: (path: string) => void
  clearPendingRename: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tree: null,
  tabs: [],
  activePath: null,

  setTree: (tree) => set({ tree }),

  openFile: (path, name, content) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.path === path)
      if (existing) {
        // Refresh saved content; keep dirty edits if any.
        return {
          tabs: s.tabs.map((t) =>
            t.path === path
              ? { ...t, name, savedContent: content, dirtyContent: t.dirtyContent }
              : t
          ),
          activePath: path
        }
      }
      return {
        tabs: [...s.tabs, { path, name, savedContent: content, dirtyContent: null }],
        activePath: path
      }
    }),

  closeTab: (path) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path)
      const tabs = s.tabs.filter((t) => t.path !== path)
      let activePath = s.activePath
      if (s.activePath === path) {
        activePath = tabs[idx]?.path ?? tabs[idx - 1]?.path ?? null
      }
      return { tabs, activePath }
    }),

  setActive: (path) => set({ activePath: path }),

  setSaved: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, savedContent: content } : t))
    })),

  edit: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path
          ? { ...t, dirtyContent: content === t.savedContent ? null : content }
          : t
      )
    })),

  markClean: (path) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, savedContent: t.dirtyContent ?? t.savedContent, dirtyContent: null } : t
      )
    })),

  renameTab: (oldPath, newPath, newName) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === oldPath ? { ...t, path: newPath, name: newName } : t
      ),
      activePath: s.activePath === oldPath ? newPath : s.activePath
    })),

  dropTabsUnder: (prefix) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => !t.path.startsWith(prefix))
      const activeStillOpen = tabs.some((t) => t.path === s.activePath)
      return {
        tabs,
        activePath: activeStillOpen ? s.activePath : tabs[0]?.path ?? null
      }
    }),

  pendingRenamePath: null,

  setPendingRename: (path) => set({ pendingRenamePath: path }),

  clearPendingRename: () => set({ pendingRenamePath: null })
}))

/** Helper: get the effective content for a tab (dirty or saved). */
export function tabContent(tab: Tab | undefined): string {
  return tab?.dirtyContent ?? tab?.savedContent ?? ''
}

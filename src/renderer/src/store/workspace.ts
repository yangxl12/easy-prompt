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
  /** When true, the tab is read-only (preview mode) and cannot be edited. */
  readOnly?: boolean
}

interface WorkspaceState {
  tree: FileNode | null
  tabs: Tab[]
  activePath: string | null

  setTree: (tree: FileNode) => void
  openFile: (path: string, name: string, content: string, readOnly?: boolean) => void
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
  /** Rewrite open tabs whose paths live under a renamed folder. */
  renameTabsUnder: (oldPrefix: string, newPrefix: string) => void
  /** Remove tabs whose paths start with the given prefix (deleted files). */
  dropTabsUnder: (prefix: string) => void
  /** Reorder tabs by moving the tab at fromIndex to toIndex. */
  moveTab: (fromIndex: number, toIndex: number) => void
  /** Close all tabs except the one with the given path. */
  closeOtherTabs: (path: string) => void
  /** Close all tabs to the right of the one with the given path. */
  closeTabsToRight: (path: string) => void
  /** Path of a newly created node that should enter rename mode on next render. */
  pendingRenamePath: string | null
  setPendingRename: (path: string) => void
  clearPendingRename: () => void
  /** Directory where a "new markdown" input is shown; the file is only created on commit. */
  pendingNewFileDir: string | null
  setPendingNewFile: (dir: string) => void
  clearPendingNewFile: () => void
  /** Multi-select in the file tree. */
  selectedPaths: string[]
  lastClickedPath: string | null
  setSelectedPaths: (paths: string[]) => void
  toggleSelectedPath: (path: string) => void
  setLastClickedPath: (path: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tree: null,
  tabs: [],
  activePath: null,

  setTree: (tree) => set({ tree }),

  openFile: (path: string, name: string, content: string, readOnly?: boolean) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.path === path)
      if (existing) {
        // Refresh saved content; keep dirty edits if any.
        // When opening without readOnly flag, reset to editable.
        return {
          tabs: s.tabs.map((t) =>
            t.path === path
              ? { ...t, name, savedContent: content, dirtyContent: t.dirtyContent, readOnly: readOnly ?? false }
              : t
          ),
          activePath: path
        }
      }
      return {
        tabs: [...s.tabs, { path, name, savedContent: content, dirtyContent: null, readOnly: readOnly ?? false }],
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

  renameTabsUnder: (oldPrefix, newPrefix) =>
    set((s) => {
      // Path separator: main-process paths use backslashes on Windows.
      const sep = (p: string): string => (p.includes('\\') ? '\\' : '/')
      const under = (p: string): boolean =>
        p === oldPrefix || p.startsWith(oldPrefix + sep(p))
      const tabs = s.tabs.map((t) =>
        under(t.path) ? { ...t, path: newPrefix + t.path.slice(oldPrefix.length) } : t
      )
      const activePath =
        s.activePath && under(s.activePath)
          ? newPrefix + s.activePath.slice(oldPrefix.length)
          : s.activePath
      return { tabs, activePath }
    }),

  dropTabsUnder: (prefix) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => !t.path.startsWith(prefix))
      const activeStillOpen = tabs.some((t) => t.path === s.activePath)
      return {
        tabs,
        activePath: activeStillOpen ? s.activePath : tabs[0]?.path ?? null
      }
    }),

  moveTab: (fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex) return s
      const tabs = [...s.tabs]
      const [moved] = tabs.splice(fromIndex, 1)
      tabs.splice(toIndex, 0, moved)
      return { tabs }
    }),

  closeOtherTabs: (path) =>
    set((s) => {
      // Keep only the tab with the matching path.
      const tabs = s.tabs.filter((t) => t.path === path)
      // If the active tab is being closed, activate the kept tab.
      const activeStillOpen = tabs.some((t) => t.path === s.activePath)
      return {
        tabs,
        activePath: activeStillOpen ? s.activePath : path
      }
    }),

  closeTabsToRight: (path) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path)
      if (idx === -1) return s
      // Keep tabs up to and including the target.
      const tabs = s.tabs.slice(0, idx + 1)
      // If the active tab was to the right, switch to the target.
      const activeStillOpen = tabs.some((t) => t.path === s.activePath)
      return {
        tabs,
        activePath: activeStillOpen ? s.activePath : path
      }
    }),

  pendingRenamePath: null,

  setPendingRename: (path) => set({ pendingRenamePath: path }),

  clearPendingRename: () => set({ pendingRenamePath: null }),

  pendingNewFileDir: null,

  setPendingNewFile: (dir) => set({ pendingNewFileDir: dir }),

  clearPendingNewFile: () => set({ pendingNewFileDir: null }),

  selectedPaths: [],
  lastClickedPath: null,

  setSelectedPaths: (paths) => set({ selectedPaths: paths }),

  toggleSelectedPath: (path) =>
    set((s) => {
      const set = new Set(s.selectedPaths)
      if (set.has(path)) set.delete(path)
      else set.add(path)
      return { selectedPaths: Array.from(set), lastClickedPath: path }
    }),

  setLastClickedPath: (path) => set({ lastClickedPath: path })
}))

/** Helper: get the effective content for a tab (dirty or saved). */
export function tabContent(tab: Tab | undefined): string {
  return tab?.dirtyContent ?? tab?.savedContent ?? ''
}

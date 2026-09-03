import type { StateCreator } from 'zustand'
import type { WorkspaceState } from './workspace'
import { isPathWithin } from '../services/pathUtils'

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
  /**
   * Monotonic version of the *effective* content (dirty ?? saved). Async AI
   * flows capture it at request time and refuse to write back when the doc
   * moved on in the meantime.
   */
  revision: number
}

/**
 * A request to scroll an open editor to a range and select it — used by global
 * search to jump to a hit. `nonce` is bumped on every request so revealing the
 * same location twice still re-triggers.
 */
export interface RevealTarget {
  /** Absolute path of the tab to reveal in. */
  path: string
  /** 1-based line number. */
  line: number
  /** 0-based column within the line. */
  column: number
  /** Length of the range to select, in code units. */
  length: number
  /** Monotonic counter — the effect key that makes repeat reveals fire. */
  nonce: number
}

/** The tab state machine: open/close/rename/reorder tabs and their edit state. */
export interface TabsSlice {
  tabs: Tab[]
  activePath: string | null
  /** Latest "scroll to this range" request, or null when none is pending. */
  pendingReveal: RevealTarget | null

  openFile: (path: string, name: string, content: string, readOnly?: boolean) => void
  closeTab: (path: string) => void
  setActive: (path: string) => void
  /** Mark a tab's on-disk content as updated (e.g. after save or external change). */
  setSaved: (path: string, content: string) => void
  /** Update the dirty (unsaved) content of a tab. */
  edit: (path: string, content: string) => void
  /**
   * Commit a successful disk write. `persistedContent` is the exact version
   * that was written: savedContent always becomes it, and dirtyContent is
   * only cleared when it still matches (i.e. the user kept typing — newer
   * edits stay dirty so they are not silently "marked saved").
   */
  commitSaved: (path: string, persistedContent: string) => void
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
  /** Ask the editor for `target.path` to scroll to that range and select it. */
  requestReveal: (target: Omit<RevealTarget, 'nonce'>) => void
}

export const createTabsSlice: StateCreator<WorkspaceState, [], [], TabsSlice> = (set) => ({
  tabs: [],
  activePath: null,
  pendingReveal: null,

  openFile: (path: string, name: string, content: string, readOnly?: boolean) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.path === path)
      if (existing) {
        // Refresh saved content; keep dirty edits if any.
        // When opening without readOnly flag, reset to editable.
        return {
          tabs: s.tabs.map((t) =>
            t.path === path
              ? {
                  ...t,
                  name,
                  savedContent: content,
                  dirtyContent: t.dirtyContent,
                  readOnly: readOnly ?? false,
                  // A content refresh changes the effective doc for clean tabs.
                  revision:
                    t.dirtyContent === null && content !== t.savedContent
                      ? t.revision + 1
                      : t.revision
                }
              : t
          ),
          activePath: path
        }
      }
      return {
        tabs: [
          ...s.tabs,
          { path, name, savedContent: content, dirtyContent: null, readOnly: readOnly ?? false, revision: 0 }
        ],
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
      tabs: s.tabs.map((t) =>
        t.path === path && t.savedContent !== content
          ? {
              ...t,
              savedContent: content,
              // Clean tabs see a new effective doc → bump the version so
              // in-flight AI writes notice the change.
              revision: t.dirtyContent === null ? t.revision + 1 : t.revision
            }
          : t
      )
    })),

  edit: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.path !== path) return t
        // No-op edits must not bump the revision.
        if (content === (t.dirtyContent ?? t.savedContent)) return t
        return {
          ...t,
          dirtyContent: content === t.savedContent ? null : content,
          revision: t.revision + 1
        }
      })
    })),

  commitSaved: (path, persistedContent) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path
          ? {
              ...t,
              savedContent: persistedContent,
              dirtyContent:
                t.dirtyContent !== null && t.dirtyContent !== persistedContent
                  ? t.dirtyContent
                  : null
            }
          : t
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
      // Subtree-aware match: `C:\ws\foo` must not close `C:\ws\foobar.md`.
      const tabs = s.tabs.filter((t) => !isPathWithin(prefix, t.path))
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

  // Reveal requests are fire-and-forget: the editor effect keys off `nonce`,
  // so a fresh object is enough to (re)trigger it.
  requestReveal: (target) =>
    set((s) => ({
      pendingReveal: { ...target, nonce: (s.pendingReveal?.nonce ?? 0) + 1 }
    }))
})

/** Helper: get the effective content for a tab (dirty or saved). */
export function tabContent(tab: Tab | undefined): string {
  return tab?.dirtyContent ?? tab?.savedContent ?? ''
}

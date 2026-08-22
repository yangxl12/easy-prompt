import { useCallback, useState } from 'react'
import { useWorkspaceStore, type Tab } from '../store/workspace'
import { writeFile } from '../services/fileOps'

/**
 * Dirty-tab close confirmation. Keeps the "save / discard / cancel" semantics:
 * closing a tab with unsaved edits must first ask the user; `save` writes to
 * disk (and marks the tab clean) before closing it.
 */
export function useTabCloseConfirm(): {
  /** The tab awaiting the user's close decision, if any. */
  pendingCloseTab: Tab | null
  /** Request closing a tab — closes clean tabs directly, dirty tabs go through the dialog. */
  requestCloseTab: (path: string) => void
  /** Resolve a pending close with the user's choice. */
  resolveCloseTab: (action: 'save' | 'discard' | 'cancel') => Promise<void>
} {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const [pendingCloseTab, setPendingCloseTab] = useState<Tab | null>(null)

  const requestCloseTab = useCallback(
    (path: string) => {
      const tab = tabs.find((t) => t.path === path)
      if (tab && tab.dirtyContent !== null) {
        setPendingCloseTab(tab)
      } else {
        closeTab(path)
      }
    },
    [tabs, closeTab]
  )

  const resolveCloseTab = useCallback(
    async (action: 'save' | 'discard' | 'cancel') => {
      const tab = pendingCloseTab
      setPendingCloseTab(null)
      if (!tab) return
      if (action === 'save') {
        const toWrite = tab.dirtyContent ?? tab.savedContent
        await writeFile(tab.path, toWrite)
        useWorkspaceStore.getState().markClean(tab.path)
        closeTab(tab.path)
      } else if (action === 'discard') {
        closeTab(tab.path)
      }
      // 'cancel' does nothing
    },
    [pendingCloseTab, closeTab]
  )

  return { pendingCloseTab, requestCloseTab, resolveCloseTab }
}

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore, type Tab } from '../store/workspace'
import { enqueueWrite } from '../services/saveQueue'
import { isDraftPath } from '../services/drafts'

/**
 * Dirty-tab close transaction. Keeps the "save / discard / cancel" semantics
 * for every close path — single tab, "close others", "close right":
 *
 * - clean tabs close immediately;
 * - dirty tabs go through one confirmation dialog (single or batch);
 * - `save` writes each real file to disk (via the per-path write queue) and
 *   commits the exact written content before closing the tab;
 * - `draft://` tabs have no backing file — they can only be discarded, never
 *   passed to file-system APIs.
 */
export function useTabCloseConfirm(): {
  /** The dirty tabs awaiting the user's close decision, if any. */
  pendingCloseTabs: Tab[] | null
  /** Request closing one tab — closes clean tabs directly, dirty ones go through the dialog. */
  requestCloseTab: (path: string) => void
  /** Request closing a set of tabs (e.g. close-right / close-others). */
  requestCloseTabs: (paths: string[]) => void
  /** Resolve a pending close with the user's choice. */
  resolveCloseTabs: (action: 'save' | 'discard' | 'cancel') => Promise<void>
} {
  const { t } = useTranslation()
  const [pendingCloseTabs, setPendingCloseTabs] = useState<Tab[] | null>(null)

  const requestCloseTabs = useCallback((paths: string[]) => {
    const { tabs, closeTab } = useWorkspaceStore.getState()
    const targets = paths
      .map((p) => tabs.find((tb) => tb.path === p))
      .filter((tb): tb is Tab => tb !== undefined)
    const dirty = targets.filter((tb) => tb.dirtyContent !== null)
    // Clean tabs close right away; dirty ones wait for the user's decision.
    for (const tb of targets) {
      if (tb.dirtyContent === null) closeTab(tb.path)
    }
    if (dirty.length > 0) {
      setPendingCloseTabs(dirty)
    }
  }, [])

  const requestCloseTab = useCallback(
    (path: string) => {
      requestCloseTabs([path])
    },
    [requestCloseTabs]
  )

  const resolveCloseTabs = useCallback(
    async (action: 'save' | 'discard' | 'cancel') => {
      const toClose = pendingCloseTabs
      setPendingCloseTabs(null)
      if (!toClose) return
      if (action === 'save') {
        for (const tab of toClose) {
          // Drafts are memory-only: never hand them to file-system APIs.
          if (tab.dirtyContent === null || isDraftPath(tab.path)) continue
          const toWrite = tab.dirtyContent
          try {
            await enqueueWrite(tab.path, toWrite)
            useWorkspaceStore.getState().commitSaved(tab.path, toWrite)
          } catch (err) {
            // A failed save must not close anything — keep the tabs open so
            // the edits stay visible and recoverable.
            window.alert(t('editor.saveFailed', { message: (err as Error).message }))
            return
          }
        }
      }
      // 'save' succeeded for all files (drafts are dropped unsaved) or the
      // user chose 'discard': close every requested tab.
      const { closeTab } = useWorkspaceStore.getState()
      for (const tab of toClose) {
        closeTab(tab.path)
      }
      // 'cancel' does nothing.
    },
    [pendingCloseTabs, t]
  )

  return { pendingCloseTabs, requestCloseTab, requestCloseTabs, resolveCloseTabs }
}

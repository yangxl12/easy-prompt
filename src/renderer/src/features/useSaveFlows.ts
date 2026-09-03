import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore, type Tab } from '../store/workspace'
import { enqueueWrite } from '../services/saveQueue'
import { isDraftPath } from '../services/drafts'

/** Auto-save writes the active tab 1.5s after the last edit. */
const AUTO_SAVE_DELAY_MS = 1500

/**
 * Persistence flows for tab content: the debounced auto-save and the manual
 * save (Ctrl/Cmd+S per-tab editor). Owns the "write to disk first, then
 * commitSaved" contract — the store may only commit the exact content that
 * was written, so edits made while a save is in flight stay dirty instead of
 * being silently marked saved.
 */
export function useSaveFlows(): {
  saveTab: (tab: Tab) => Promise<void>
  /** Last save failure (auto or manual), rendered by the host. */
  saveError: string | null
} {
  const { t } = useTranslation()
  const autoSave = useConfigStore((s) => s.config.app.autoSave)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const activeTab = tabs.find((tb) => tb.path === activePath) ?? null
  const [saveError, setSaveError] = useState<string | null>(null)

  // Auto-save debounce: when autoSave is on, save 1.5s after the last edit.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const performAutoSave = useCallback(async (): Promise<void> => {
    const tab = activeTabRef.current
    // Auto-save only applies to real files — drafts never touch the fs.
    if (!tab || isDraftPath(tab.path)) return
    try {
      const toWrite = tab.dirtyContent ?? tab.savedContent
      await enqueueWrite(tab.path, toWrite)
      useWorkspaceStore.getState().commitSaved(tab.path, toWrite)
      setSaveError(null)
    } catch (err) {
      // A failed save must be visible — silent failure + a cleared dirty flag
      // is how data gets lost.
      setSaveError(t('editor.saveFailed', { message: (err as Error).message }))
    }
  }, [t])

  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (autoSave && activeTab && activeTab.dirtyContent !== null && !isDraftPath(activeTab.path)) {
      autoSaveTimerRef.current = setTimeout(() => {
        void performAutoSave()
      }, AUTO_SAVE_DELAY_MS)
    }
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [autoSave, activeTab?.dirtyContent, activeTab?.path, performAutoSave])

  /** Save a specific tab (used by per-tab editors via Ctrl+S). */
  const saveTab = useCallback(
    async (tab: Tab): Promise<void> => {
      if (tab.readOnly) return
      if (isDraftPath(tab.path)) {
        // No Save-As flow yet — just inform the user.
        window.alert(t('editor.draftSaveHint'))
        return
      }
      try {
        const toWrite = tab.dirtyContent ?? tab.savedContent
        await enqueueWrite(tab.path, toWrite)
        useWorkspaceStore.getState().commitSaved(tab.path, toWrite)
        setSaveError(null)
      } catch (err) {
        setSaveError(t('editor.saveFailed', { message: (err as Error).message }))
      }
    },
    [t]
  )

  return { saveTab, saveError }
}

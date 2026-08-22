import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore, type Tab } from '../store/workspace'
import { writeFile } from '../services/fileOps'
import { isDraftPath } from '../services/drafts'

/** Auto-save writes the active tab 1.5s after the last edit. */
const AUTO_SAVE_DELAY_MS = 1500

/**
 * Persistence flows for tab content: the debounced auto-save and the manual
 * save (Ctrl/Cmd+S per-tab editor). Owns the "write to disk first, then
 * markClean" contract — markClean may only run after a successful write.
 */
export function useSaveFlows(): { saveTab: (tab: Tab) => Promise<void> } {
  const { t } = useTranslation()
  const autoSave = useConfigStore((s) => s.config.app.autoSave)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const markClean = useWorkspaceStore((s) => s.markClean)
  const activeTab = tabs.find((tb) => tb.path === activePath) ?? null

  // Auto-save debounce: when autoSave is on, save 1.5s after the last edit.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const performAutoSave = useCallback(async (): Promise<void> => {
    const tab = activeTabRef.current
    // Auto-save only applies to real files — drafts never touch the fs.
    if (!tab || isDraftPath(tab.path)) return
    const toWrite = tab.dirtyContent ?? tab.savedContent
    await writeFile(tab.path, toWrite)
    useWorkspaceStore.getState().markClean(tab.path)
  }, [])

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
      const toWrite = tab.dirtyContent ?? tab.savedContent
      await writeFile(tab.path, toWrite)
      markClean(tab.path)
    },
    [t, markClean]
  )

  return { saveTab }
}

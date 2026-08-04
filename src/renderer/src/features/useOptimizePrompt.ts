import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '../store/workspace'
import { optimizePrompt } from '../services/ai'
import { createFile, writeFile, readFileSync } from '../services/fileOps'
import { useWorkspaceRoot } from '../services/workspaceRoot'

/**
 * "Optimize prompt" workflow. Given the active tab's content, calls the AI to
 * polish it, then asks the user whether to overwrite the original or save the
 * optimized version as a new file.
 *
 * Returns a stateful controller to drive the UI (busy flag, errors, and the
 * pending ChoiceDialog once the AI responds).
 */
export interface OptimizeState {
  busy: boolean
  error: string | null
  /** The optimized text awaiting the user's overwrite/keep decision. */
  pending: { original: string; optimized: string; tabPath: string } | null
  /**
   * Partial optimized text as it streams in. Only non-null while streaming is
   * in progress; lets the UI show a live preview instead of an inert spinner.
   */
  streaming: string | null
}

export function useOptimizePrompt(): OptimizeState & {
  run: () => Promise<void>
  resolve: (choice: 'overwrite' | 'keep' | 'cancel') => Promise<void>
  abort: () => void
} {
  const { t } = useTranslation()
  const root = useWorkspaceRoot()
  const [state, setState] = useState<OptimizeState>({
    busy: false,
    error: null,
    pending: null,
    streaming: null
  })
  /** Guards against concurrent resolve calls triggered by re-render storms. */
  const resolvingRef = useRef(false)
  /** Current abort function, set during an active run. */
  const abortRef = useRef<(() => void) | null>(null)

  const run = async (): Promise<void> => {
    // Read fresh from the store rather than a captured hook value, so a stale
    // closure (e.g. a delayed click) can't optimize the wrong tab.
    const { activePath, tabs } = useWorkspaceStore.getState()
    const tab = tabs.find((tb) => tb.path === activePath)
    if (!tab) return
    const original = tab.dirtyContent ?? tab.savedContent
    if (!original.trim()) return
    setState({ busy: true, error: null, pending: null, streaming: '' })
    try {
      const { result, abort } = optimizePrompt(original, (delta) => {
        // Functional update so concurrent chunks compose without clobbering.
        setState((s) => (s.busy ? { ...s, streaming: (s.streaming ?? '') + delta } : s))
      })
      // Capture abort synchronously so the stop button works immediately,
      // without waiting for the AI call's promise to settle.
      abortRef.current = abort
      const { result: optimized, aborted } = await result
      if (aborted) {
        setState({ busy: false, error: null, pending: null, streaming: null })
        return
      }
      setState({ busy: false, error: null, pending: { original, optimized, tabPath: tab.path }, streaming: null })
    } catch (err) {
      setState({ busy: false, error: t('ai.error', { message: (err as Error).message }), pending: null, streaming: null })
    } finally {
      abortRef.current = null
    }
  }

  const abort = (): void => {
    abortRef.current?.()
  }

  const resolve = async (choice: 'overwrite' | 'keep' | 'cancel'): Promise<void> => {
    // Allow cancel to always go through, even if a resolve is in flight.
    if (choice === 'cancel') {
      resolvingRef.current = false
      setState({ busy: false, error: null, pending: null, streaming: null })
      return
    }

    // Prevent concurrent resolve calls — the Workspace effect can re-fire
    // before the first resolve clears `pending`, leading to double writes.
    if (resolvingRef.current) return
    const pending = state.pending
    if (!pending) {
      setState({ busy: false, error: null, pending: null, streaming: null })
      return
    }
    resolvingRef.current = true
    const { edit, markClean, openFile } = useWorkspaceStore.getState()
    try {
      if (choice === 'overwrite') {
        await writeFile(pending.tabPath, pending.optimized)
        // Update the editor text first (sets dirtyContent), then mark the tab
        // clean so savedContent absorbs the new text and dirty clears.
        // Order matters: markClean snapshots the *current* dirtyContent, so the
        // edit must land before it.
        edit(pending.tabPath, pending.optimized)
        markClean(pending.tabPath)
      } else {
        // save as new file: "<name>-optimized.md" next to the original
        const dir = pending.tabPath.includes('/')
          ? pending.tabPath.slice(0, pending.tabPath.lastIndexOf('/'))
          : root
        const baseName = pending.tabPath.split('/').pop()?.replace(/\.md$/i, '') ?? 'prompt'
        const newPath = await createFile(dir, `${baseName}-optimized`)
        await writeFile(newPath, pending.optimized)
        const content = await readFileSync(newPath)
        openFile(newPath, newPath.split('/').pop() ?? '', content)
      }
    } catch (err) {
      resolvingRef.current = false
      setState({ busy: false, error: t('ai.error', { message: (err as Error).message }), pending: null, streaming: null })
      return
    }
    resolvingRef.current = false
    setState({ busy: false, error: null, pending: null, streaming: null })
  }

  return { ...state, run, resolve, abort }
}

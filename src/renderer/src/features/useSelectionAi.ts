import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AppConfig } from '@shared/types'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore } from '../store/workspace'
import { optimizePrompt, polishText } from '../services/ai'
import type { EditorCommands } from '../components/EditorPane/CodeEditor'

/** Live streaming state shared by the optimize-selection / polish-selection flows. */
interface SelectionAiState {
  busy: boolean
  streaming: string | null
  error: string | null
}

const IDLE: SelectionAiState = { busy: false, streaming: null, error: null }

type StreamingService = (
  config: AppConfig,
  text: string,
  onDelta?: (delta: string) => void
) => { result: Promise<{ result: string; aborted: boolean }>; abort: () => void }

/**
 * AI actions on the active editor's selection: optimize (prompt-crafting) and
 * polish (prose). Both stream into a live-preview bar, then splice the result
 * back into the document, replacing the original selection in place.
 *
 * The result is applied through the captured tab's own editor commands, so
 * even if the user switches tabs mid-flight the replacement lands in the
 * original tab (re-confirming the write-back target).
 */
export function useSelectionAi(
  commandsMapRef: RefObject<Map<string, EditorCommands>>
): {
  selectionOptimize: SelectionAiState
  selectionPolish: SelectionAiState
  optimizeSelection: () => Promise<void>
  polishSelection: () => Promise<void>
  /** Cancel an in-flight optimize-selection call. */
  abortSelectionOptimize: () => void
  /** Cancel an in-flight polish-selection call. */
  abortSelectionPolish: () => void
} {
  const { t } = useTranslation()
  const activePath = useWorkspaceStore((s) => s.activePath)
  const activeTab = useWorkspaceStore((s) => s.tabs.find((tb) => tb.path === s.activePath) ?? null)

  const [selectionOptimize, setSelectionOptimize] = useState<SelectionAiState>(IDLE)
  const [selectionPolish, setSelectionPolish] = useState<SelectionAiState>(IDLE)
  const selAbortRef = useRef<(() => void) | null>(null)
  const polishAbortRef = useRef<(() => void) | null>(null)

  const runSelectionAi = useCallback(
    async (
      service: StreamingService,
      setState: Dispatch<SetStateAction<SelectionAiState>>,
      abortRef: MutableRefObject<(() => void) | null>
    ): Promise<void> => {
      if (!activePath || !activeTab) return
        const cmds = commandsMapRef.current?.get(activePath)
        if (!cmds) return
        const selectedText = cmds.getSelectionText()
        if (!selectedText.trim()) return
        setState({ busy: true, streaming: '', error: null })
        try {
          // Fresh config snapshot so a model switch mid-session is respected.
          const config = useConfigStore.getState().config
          const { result, abort } = service(config, selectedText, (delta) => {
            // Functional update so concurrent chunks compose without clobbering.
            setState((s) => (s.busy ? { ...s, streaming: (s.streaming ?? '') + delta } : s))
          })
          // Capture abort synchronously so the stop button works immediately.
          abortRef.current = abort
          const { result: replaced, aborted } = await result
          if (aborted) {
            // Cancellation is a normal termination — not an error.
            setState(IDLE)
            return
          }
          setState(IDLE)
          // Splice the result back into the document, replacing the original
          // selection in place.
          cmds.replaceSelection(replaced)
        } catch (err) {
          setState({ busy: false, streaming: null, error: t('ai.error', { message: (err as Error).message }) })
      } finally {
        abortRef.current = null
      }
    },
    [activePath, activeTab, commandsMapRef, t]
  )

  const optimizeSelection = useCallback(
    (): Promise<void> => runSelectionAi(optimizePrompt, setSelectionOptimize, selAbortRef),
    [runSelectionAi]
  )
  const polishSelection = useCallback(
    (): Promise<void> => runSelectionAi(polishText, setSelectionPolish, polishAbortRef),
    [runSelectionAi]
  )

  const abortSelectionOptimize = useCallback((): void => {
    selAbortRef.current?.()
  }, [])
  const abortSelectionPolish = useCallback((): void => {
    polishAbortRef.current?.()
  }, [])

  return {
    selectionOptimize,
    selectionPolish,
    optimizeSelection,
    polishSelection,
    abortSelectionOptimize,
    abortSelectionPolish
  }
}

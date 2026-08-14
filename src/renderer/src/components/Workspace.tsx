import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore, tabContent, type Tab } from '../store/workspace'
import { writeFile } from '../services/fileOps'
import { useWorkspaceRoot } from '../services/workspaceRoot'
import { optimizePrompt, polishText } from '../services/ai'
import TabBar from './EditorPane/TabBar'
import CodeEditor, { type EditorCommands } from './EditorPane/CodeEditor'
import SplitPane from './EditorPane/SplitPane'
import MarkdownPreview from './PreviewPane/MarkdownPreview'
import { SparkleIcon, FeatherIcon, ImageIcon, SettingsIcon } from './ui/icons'
import { Button } from './ui/Button'
import ChoiceDialog from './ui/ChoiceDialog'
import { useContextMenu, type MenuItemDef } from './ui/ContextMenu'
import { useOptimizePrompt } from '../features/useOptimizePrompt'
import { useImagePaste } from '../features/useImageToPrompt'

/** Path prefix for transient in-memory tabs created by dropping onto the empty state. */
const DRAFT_PREFIX = 'draft://'

interface WorkspaceProps {
  onOpenSettings: () => void
}

export default function Workspace({ onOpenSettings }: WorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const { open: openMenu } = useContextMenu()
  const aiReady = useConfigStore((s) => s.aiReady())
  const autoSave = useConfigStore((s) => s.config.app.autoSave)
  const optimizeDefaultAction = useConfigStore((s) => s.config.app.optimizeDefaultAction)
  const showOptimizeWholeFile = useConfigStore((s) => s.config.app.showOptimizeWholeFile)
  const showPreview = useConfigStore((s) => s.config.app.showPreview)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const openFile = useWorkspaceStore((s) => s.openFile)
  const pendingRenamePath = useWorkspaceStore((s) => s.pendingRenamePath)
  const markClean = useWorkspaceStore((s) => s.markClean)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const edit = useWorkspaceStore((s) => s.edit)
  const setActive = useWorkspaceStore((s) => s.setActive)
  const workspaceRoot = useWorkspaceRoot()

  const activeTab = tabs.find((tb) => tb.path === activePath) ?? null
  const content = tabContent(activeTab ?? undefined)
  const optimize = useOptimizePrompt()
  const image = useImagePaste()

  // Imperative editor commands for each tab, keyed by path. Used by the
  // right-click context menu and to focus the editor on tab switch.
  const commandsMapRef = useRef<Map<string, EditorCommands>>(new Map())
  // Drag-over state lives here (parent) so the editor can stay a dumb view.
  const [dropActive, setDropActive] = useState(false)
  // Track whether the active editor has a text selection.
  const [hasSelection, setHasSelection] = useState(false)

  // Focus the newly-active editor when the active tab changes.
  // Skip auto-focus while a tree node is in rename mode — the RenameInput
  // needs the focus and the editor would steal it (especially on macOS where
  // setTimeout(0) fires before the rename input's synchronous focus settles).
  // `pendingRenamePath` is also a dependency: when a rename commits/cancels it
  // transitions to null, and we restore editor focus — otherwise the input's
  // unmount drops focus to <body> and the next keystrokes go nowhere.
  useEffect(() => {
    if (activePath && !pendingRenamePath) {
      // Use a short timeout so the browser has a chance to update display:none
      // before we try to focus the (now visible) CodeMirror element.
      const id = setTimeout(() => {
        // Re-check in case a rename started between scheduling and execution.
        if (!useWorkspaceStore.getState().pendingRenamePath) {
          commandsMapRef.current.get(activePath)?.focus()
        }
      }, 0)
      return () => clearTimeout(id)
    }
    return
  }, [activePath, pendingRenamePath])

  // Reset selection state when active tab changes — the new editor's selection
  // state will be reported on the next user interaction.
  useEffect(() => {
    setHasSelection(false)
  }, [activePath])

  const isDraft = activeTab?.path.startsWith(DRAFT_PREFIX) ?? false

  // Auto-save debounce: when autoSave is on, save 1.5s after the last edit.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  // Auto-resolve optimize when config says overwrite or keep (skip the dialog).
  // Use a ref for resolve so the effect doesn't re-fire on every render just
  // because the `optimize` spread object is a new reference each time.
  const optimizeResolveRef = useRef(optimize.resolve)
  optimizeResolveRef.current = optimize.resolve

  useEffect(() => {
    if (optimize.pending && optimizeDefaultAction !== 'ask') {
      void optimizeResolveRef.current(optimizeDefaultAction)
    }
  }, [optimize.pending, optimizeDefaultAction])

  const performAutoSave = useCallback(async (): Promise<void> => {
    const tab = activeTabRef.current
    if (!tab || tab.path.startsWith(DRAFT_PREFIX)) return
    const toWrite = tab.dirtyContent ?? tab.savedContent
    await writeFile(tab.path, toWrite)
    useWorkspaceStore.getState().markClean(tab.path)
  }, [])

  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (autoSave && activeTab && !isDraft && activeTab.dirtyContent !== null) {
      autoSaveTimerRef.current = setTimeout(() => {
        void performAutoSave()
      }, 1500)
    }
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [autoSave, activeTab?.dirtyContent, activeTab?.path, isDraft, performAutoSave])

  // Pending-close confirmation for unsaved tabs.
  const [pendingCloseTab, setPendingCloseTab] = useState<Tab | null>(null)

  const requestCloseTab = useCallback((path: string) => {
    const tab = tabs.find((t) => t.path === path)
    if (tab && tab.dirtyContent !== null) {
      setPendingCloseTab(tab)
    } else {
      closeTab(path)
    }
  }, [tabs, closeTab])

  const resolveCloseTab = useCallback(async (action: 'save' | 'discard' | 'cancel') => {
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
  }, [pendingCloseTab, closeTab])

  /** Save a specific tab (used by per-tab editors via Ctrl+S). */
  const saveTab = useCallback(
    async (tab: Tab): Promise<void> => {
      if (tab.readOnly) return
      if (tab.path.startsWith(DRAFT_PREFIX)) {
        window.alert(t('editor.draftSaveHint'))
        return
      }
      const toWrite = tab.dirtyContent ?? tab.savedContent
      await writeFile(tab.path, toWrite)
      markClean(tab.path)
    },
    [t, markClean]
  )

  /** Create a new Markdown file and open it. */
  const handleNewFile = useCallback((): void => {
    if (!workspaceRoot) return
    // Show the empty name input in the sidebar; the file is created on commit.
    useWorkspaceStore.getState().setPendingNewFile(workspaceRoot)
  }, [workspaceRoot])

  /** Switch to the next tab (with wrap-around). */
  const goToNextTab = useCallback(() => {
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((tb) => tb.path === activePath)
    const next = idx < tabs.length - 1 ? tabs[idx + 1] : tabs[0]
    setActive(next.path)
  }, [tabs, activePath, setActive])

  /** Switch to the previous tab (with wrap-around). */
  const goToPrevTab = useCallback(() => {
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((tb) => tb.path === activePath)
    const prev = idx > 0 ? tabs[idx - 1] : tabs[tabs.length - 1]
    setActive(prev.path)
  }, [tabs, activePath, setActive])

  const handleConvertImage = async (): Promise<void> => {
    if (!activeTab || image.busy) return
    // Capture the data URL BEFORE convert(): convert() does not clear it, but
    // capturing up front keeps this handler robust against any future change.
    const keptDataUrl = image.dataUrl
    const prompt = await image.convert()
    // On failure, DO NOT dismiss — keep the banner + error so the user can see
    // what went wrong and retry. Only clear state on success.
    if (!prompt) return
    let next = prompt
    if (keptDataUrl) {
      // Inline the image before the generated prompt so the doc stays visual.
      next = `![pasted-ui.png](${keptDataUrl})\n\n${prompt}`
    }
    const updated = content ? `${content}\n\n${next}` : next
    edit(activeTab.path, updated)
    image.dismiss()
  }

  /**
   * Image ingress shared by paste + drop + file picker. When no tab is open,
   * dropping creates a fresh draft tab first so the result has somewhere to land.
   */
  const handleImageFile = useCallback(
    (file: File): void => {
      if (!activeTab) {
        const path = `${DRAFT_PREFIX}${Date.now()}`
        openFile(path, t('editor.untitled'), '')
      }
      image.onPasteImage(file)
    },
    [activeTab, openFile, image, t]
  )

  /**
   * Optimize the current editor selection in place (used by the right-click
   * "optimize selection" item). Streams into the same live-preview bar, then
   * replaces just the selected range when done.
   */
  const [selectionOptimize, setSelectionOptimize] = useState<{
    busy: boolean
    streaming: string | null
    error: string | null
  }>({ busy: false, streaming: null, error: null })
  const selAbortRef = useRef<(() => void) | null>(null)

  const optimizeSelection = useCallback(async (): Promise<void> => {
    if (!activePath || !activeTab) return
    const cmds = commandsMapRef.current.get(activePath)
    if (!cmds) return
    const selectedText = cmds.getSelectionText()
    if (!selectedText.trim()) return
    setSelectionOptimize({ busy: true, streaming: '', error: null })
    try {
      const { result, abort } = optimizePrompt(selectedText, (delta) => {
        setSelectionOptimize((s) => (s.busy ? { ...s, streaming: (s.streaming ?? '') + delta } : s))
      })
      // Capture abort synchronously so the stop button works immediately.
      selAbortRef.current = abort
      const { result: optimized, aborted } = await result
      if (aborted) {
        setSelectionOptimize({ busy: false, streaming: null, error: null })
        return
      }
      setSelectionOptimize({ busy: false, streaming: null, error: null })
      // Splice the optimized text back into the document, replacing the
      // original selection in place.
      cmds.replaceSelection(optimized)
    } catch (err) {
      setSelectionOptimize({ busy: false, streaming: null, error: t('ai.error', { message: (err as Error).message }) })
    } finally {
      selAbortRef.current = null
    }
  }, [activeTab, t])

  /**
   * Polish the current editor selection as prose (articles, notes, journals).
   * Same in-place replace flow as optimizeSelection, but tuned for everyday
   * writing instead of prompt crafting.
   */
  const [selectionPolish, setSelectionPolish] = useState<{
    busy: boolean
    streaming: string | null
    error: string | null
  }>({ busy: false, streaming: null, error: null })
  const polishAbortRef = useRef<(() => void) | null>(null)

  const polishSelection = useCallback(async (): Promise<void> => {
    if (!activePath || !activeTab) return
    const cmds = commandsMapRef.current.get(activePath)
    if (!cmds) return
    const selectedText = cmds.getSelectionText()
    if (!selectedText.trim()) return
    setSelectionPolish({ busy: true, streaming: '', error: null })
    try {
      const { result, abort } = polishText(selectedText, (delta) => {
        setSelectionPolish((s) => (s.busy ? { ...s, streaming: (s.streaming ?? '') + delta } : s))
      })
      // Capture abort synchronously so the stop button works immediately.
      polishAbortRef.current = abort
      const { result: polished, aborted } = await result
      if (aborted) {
        setSelectionPolish({ busy: false, streaming: null, error: null })
        return
      }
      setSelectionPolish({ busy: false, streaming: null, error: null })
      // Splice the polished text back into the document, replacing the
      // original selection in place.
      cmds.replaceSelection(polished)
    } catch (err) {
      setSelectionPolish({ busy: false, streaming: null, error: t('ai.error', { message: (err as Error).message }) })
    } finally {
      polishAbortRef.current = null
    }
  }, [activeTab, t])

  /**
   * Pick an image: try the system clipboard first (so the common "screenshot
   * then click the button" flow is one click), and fall back to a native file
   * picker when the clipboard has no image or read access is denied. Files are
   * routed through the same `handleImageFile` ingress as paste/drop.
   */
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pickImage = useCallback(async (): Promise<void> => {
    // 1. Try the system clipboard.
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((tp) => tp.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          handleImageFile(new File([blob], 'pasted.png', { type: imageType }))
          return
        }
      }
    } catch {
      // No clipboard image or permission denied — fall through to the picker.
    }
    // 2. Fall back to a native file picker. We trigger it from the ref rather
    // than constructing a fresh <input> each click so we stay uncontrolled.
    fileInputRef.current?.click()
  }, [handleImageFile])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, hasSelection: boolean): void => {
      const cmds = activePath ? commandsMapRef.current.get(activePath) : undefined
      const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
      const isReadOnly = activeTab?.readOnly ?? false
      const items: MenuItemDef[] = [
        {
          id: 'cut',
          label: t('editor.cut'),
          shortcut: `${mod}X`,
          disabled: !hasSelection || isReadOnly,
          onClick: () => cmds?.cut()
        },
        {
          id: 'copy',
          label: t('editor.copy'),
          shortcut: `${mod}C`,
          disabled: !hasSelection,
          onClick: () => cmds?.copy()
        },
        {
          id: 'paste',
          label: t('editor.paste'),
          shortcut: `${mod}V`,
          disabled: isReadOnly,
          onClick: () => cmds?.paste(),
          separatorAfter: true
        },
        {
          id: 'paste-image',
          label: t('editor.pasteImage'),
          disabled: isReadOnly,
          onClick: () => void pickImage()
        },
        {
          id: 'optimize-selection',
          label: t('editor.optimizeSelection'),
          disabled: !hasSelection || !aiReady || isReadOnly,
          onClick: () => void optimizeSelection(),
          separatorAfter: true
        },
        {
          id: 'select-all',
          label: t('editor.selectAll'),
          shortcut: `${mod}A`,
          onClick: () => cmds?.selectAll()
        },
        {
          id: 'undo',
          label: t('editor.undo'),
          shortcut: `${mod}Z`,
          disabled: isReadOnly,
          onClick: () => cmds?.undo()
        },
        {
          id: 'redo',
          label: t('editor.redo'),
          shortcut: `Shift+${mod}Z`,
          disabled: isReadOnly,
          onClick: () => cmds?.redo()
        }
      ]
      openMenu(e, items)
    },
    [aiReady, activePath, activeTab?.readOnly, openMenu, optimizeSelection, pickImage, t]
  )

  const hasOpenTab = activeTab !== null
  const busy = optimize.busy || image.busy || selectionOptimize.busy || selectionPolish.busy
  const aiError = optimize.error ?? image.error ?? selectionOptimize.error ?? selectionPolish.error

  // Stats for the status bar: line count + char count of the active document.
  const stats = useMemo(() => {
    if (!content) return { lines: 0, chars: 0 }
    const lines = content.split('\n').length
    const chars = content.length
    return { lines, chars }
  }, [content])

  return (
    <main
      className="flex min-w-0 flex-1 flex-col bg-bg-base"
      onDragOver={(e) => {
        // Allow file drops so the browser doesn't navigate away (belt + suspenders
        // with main-process will-navigate prevention).
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
        }
      }}
      onDrop={(e) => {
        // If a child already handled the drop (EmptyState, CodeEditor), skip.
        if (e.defaultPrevented) return
        // Catch-all drop prevention: even if no child handles the drop, stop the
        // browser from navigating to a file:// URL.
        e.preventDefault()
        setDropActive(false)
        // Image ingress: if an image was dropped and we're in active-tab state,
        // route it to the same handleImageFile used by paste/picker.
        const files = e.dataTransfer.files
        if (files && files.length > 0) {
          for (let i = 0; i < files.length; i++) {
            if (files[i].type.startsWith('image/')) {
              handleImageFile(files[i])
              return
            }
          }
        }
      }}
    >
      {/* AI action bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {/* Optimize whole file — only shown when enabled in settings */}
        {showOptimizeWholeFile && (
          <Button
            variant="primary"
            size="sm"
            disabled={!aiReady || !hasOpenTab || busy}
            title={t('ai.optimizeHelp')}
            onClick={() => void optimize.run()}
          >
            <SparkleIcon />
            {optimize.busy ? t('ai.working') : t('ai.optimizeWholeFile')}
          </Button>
        )}

        {/* Optimize selection — always visible */}
        <Button
          variant="primary"
          size="sm"
          disabled={!aiReady || !hasOpenTab || !hasSelection || busy}
          title={!hasSelection ? t('ai.selectTextFirst') : t('ai.optimizeHelp')}
          onClick={() => void optimizeSelection()}
        >
          <SparkleIcon />
          {selectionOptimize.busy ? t('ai.working') : t('ai.optimizeSelection')}
        </Button>

        {/* Polish selection as prose — always visible */}
        <Button
          variant="secondary"
          size="sm"
          disabled={!aiReady || !hasOpenTab || !hasSelection || busy}
          title={!hasSelection ? t('ai.selectTextFirst') : t('ai.polishHelp')}
          onClick={() => void polishSelection()}
        >
          <FeatherIcon />
          {selectionPolish.busy ? t('ai.working') : t('ai.polishSelection')}
        </Button>

        {/* Stop button — visible during any AI operation */}
        {busy && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (optimize.busy) optimize.abort()
              if (selectionOptimize.busy) selAbortRef.current?.()
              if (selectionPolish.busy) polishAbortRef.current?.()
            }}
          >
            {t('ai.stop')}
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          disabled={!aiReady || !hasOpenTab || busy}
          title={t('ai.convertHelp')}
          onClick={() => void pickImage()}
        >
          <ImageIcon />
          {image.busy ? t('ai.converting') : t('ai.imageToPrompt')}
        </Button>

        {aiError && <span className="text-xs text-red-600">{aiError}</span>}
        {!aiReady && (
          <button
            onClick={onOpenSettings}
            className="ml-auto flex items-center gap-1 text-xs text-text-muted underline-offset-2 hover:underline"
          >
            <SettingsIcon />
            {t('ai.notConfigured')}
          </button>
        )}
      </div>

      {/* Pasted/dropped-image banner: clear CTA, error retention + retry. */}
      {image.dataUrl && (
        <div className="flex items-center gap-3 border-b border-border bg-accent-soft/50 px-3 py-2">
          <img
            src={image.dataUrl}
            alt="pasted"
            className="h-10 w-10 rounded border border-border object-cover"
          />
          <div className="min-w-0 flex-1">
            <span className="block text-xs text-text-muted">
              {image.busy ? t('ai.converting') : t('ai.capturedImage')}
              {image.sizeKB > 0 && !image.busy && (
                <span className="ml-1 text-[11px] text-text-muted/70">
                  {t('ai.imageSize', { size: image.sizeKB })}
                </span>
              )}
            </span>
            {image.error && (
              <span className="block truncate text-xs text-red-600">{image.error}</span>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            {image.error && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void handleConvertImage()}
              >
                {t('ai.retry')}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void handleConvertImage()}
            >
              {image.busy ? '…' : t('ai.convert')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => image.dismiss()}>
              {t('ai.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Live streaming preview while AI is polishing (whole-doc optimize). */}
      {optimize.streaming !== null && (
        <div className="border-b border-border bg-accent-soft/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-xs text-text-muted">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {t('ai.streaming')}
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-text">
            {optimize.streaming || '…'}
          </pre>
        </div>
      )}

      {/* Live streaming preview for selection optimization. */}
      {selectionOptimize.streaming !== null && (
        <div className="border-b border-border bg-accent-soft/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-xs text-text-muted">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {t('ai.streaming')}
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-text">
            {selectionOptimize.streaming || '…'}
          </pre>
        </div>
      )}

      {/* Live streaming preview for selection polishing. */}
      {selectionPolish.streaming !== null && (
        <div className="border-b border-border bg-accent-soft/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-xs text-text-muted">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {t('ai.streaming')}
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-text">
            {selectionPolish.streaming || '…'}
          </pre>
        </div>
      )}

      {!hasOpenTab ? (
        <EmptyState onDropImage={handleImageFile} />
      ) : (
        <>
          <TabBar onRequestClose={requestCloseTab} />
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* Render an editor for every open tab so undo history survives tab switches.
                Only the active tab's editor is visible; others are display:none. */}
            {tabs.map((tab) => {
              const isActive = tab.path === activePath
              const tabStr = tabContent(tab)

              const editor = (
                <CodeEditor
                  value={tabStr}
                  onChange={(v) => {
                    if (!tab.readOnly) edit(tab.path, v)
                  }}
                  readOnly={tab.readOnly}
                  onSave={() => {
                    void saveTab(tab)
                  }}
                  onPasteImage={isActive ? handleImageFile : undefined}
                  onDropImage={isActive ? handleImageFile : undefined}
                  onContextMenu={handleContextMenu}
                  dropActive={isActive ? dropActive : false}
                  onDropActiveChange={isActive ? setDropActive : () => {}}
                  dropHint={isActive ? t('editor.dropImageHint') : undefined}
                  registerCommands={(cmds) => {
                    commandsMapRef.current.set(tab.path, cmds)
                  }}
                  onCloseTab={isActive ? () => requestCloseTab(tab.path) : undefined}
                  onNewFile={isActive ? handleNewFile : undefined}
                  onNextTab={isActive ? goToNextTab : undefined}
                  onPrevTab={isActive ? goToPrevTab : undefined}
                  onSelectionChange={isActive ? setHasSelection : undefined}
                />
              )

              return (
                <div
                  key={`${tab.path}${tab.readOnly ? ':ro' : ''}`}
                  style={{ display: isActive ? undefined : 'none' }}
                  className="min-h-0 flex-1 relative"
                >
                  {tab.readOnly ? (
                    <div className="absolute inset-0 flex min-h-0">
                      <MarkdownPreview source={tabStr} />
                    </div>
                  ) : showPreview ? (
                    <div className="absolute inset-0 flex min-h-0">
                      <SplitPane
                        left={editor}
                        right={<MarkdownPreview source={tabStr} />}
                      />
                    </div>
                  ) : (
                    editor
                  )}
                </div>
              )
            })}
            {/* Status bar: line + char counts */}
            <div className="flex items-center justify-end gap-3 border-t border-border bg-bg-surface px-3 py-1 text-[11px] text-text-muted">
              <span>{t('editor.lines', { count: stats.lines })}</span>
              <span>{t('editor.chars', { count: stats.chars })}</span>
            </div>
          </div>
        </>
      )}

      {/* Optimize: overwrite / keep-as-new dialog (only shown when config is 'ask') */}
      {optimize.pending && optimizeDefaultAction === 'ask' && (
        <ChoiceDialog
          title={t('ai.optimize')}
          description={t('ai.optimizeHelp')}
          dismissible
          onCancel={() => void optimize.resolve('cancel')}
          options={[
            { label: t('ai.overwrite'), value: 'overwrite', variant: 'danger' },
            { label: t('ai.keepOriginal'), value: 'keep', variant: 'primary' }
          ]}
          onChoose={(v) => void optimize.resolve(v as 'overwrite' | 'keep')}
        />
      )}

      {/* Unsaved changes confirmation when closing a dirty tab. */}
      {pendingCloseTab && (
        <ChoiceDialog
          title={t('editor.unsavedChanges')}
          description={t('editor.unsavedChangesMessage', { name: pendingCloseTab.name })}
          dismissible
          onCancel={() => resolveCloseTab('cancel')}
          options={[
            { label: t('editor.saveAndClose'), value: 'save', variant: 'primary' },
            { label: t('editor.discardChanges'), value: 'discard', variant: 'danger' },
            { label: t('common.cancel'), value: 'cancel', variant: 'secondary' }
          ]}
          onChoose={(v) => { void resolveCloseTab(v as 'save' | 'discard' | 'cancel') }}
        />
      )}

      {/* Hidden file picker backing the toolbar "image→prompt" button. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleImageFile(file)
          // Reset so picking the same file twice still fires onChange.
          e.target.value = ''
        }}
      />
    </main>
  )
}

function EmptyState({ onDropImage }: { onDropImage?: (file: File) => void }): JSX.Element {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  return (
    <div
      className={`flex min-h-0 flex-1 items-center justify-center text-text-muted ${
        dragOver ? 'bg-accent-soft/20 ring-2 ring-inset ring-accent' : ''
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const files = e.dataTransfer.files
        if (!files || files.length === 0) return
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith('image/')) {
            onDropImage?.(files[i])
            return
          }
        }
      }}
    >
      <div className="max-w-sm text-center">
        <div className="mb-3 text-3xl">✦</div>
        <h2 className="mb-1 text-base font-semibold text-text">{t('app.title')}</h2>
        <p className="text-sm">{t('tree.empty')}</p>
        <p className="mt-2 text-xs text-text-muted">{t('ai.pasteImageHint')}</p>
      </div>
    </div>
  )
}

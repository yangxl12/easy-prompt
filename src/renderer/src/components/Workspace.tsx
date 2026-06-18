import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore, tabContent, type Tab } from '../store/workspace'
import { writeFile } from '../services/fileOps'
import { optimizePrompt } from '../services/ai'
import TabBar from './EditorPane/TabBar'
import CodeEditor, { type EditorCommands } from './EditorPane/CodeEditor'
import SplitPane from './EditorPane/SplitPane'
import MarkdownPreview from './PreviewPane/MarkdownPreview'
import { SparkleIcon, ImageIcon, SettingsIcon } from './ui/icons'
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
  const showPreview = useConfigStore((s) => s.config.app.showPreview)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const edit = useWorkspaceStore((s) => s.edit)
  const openFile = useWorkspaceStore((s) => s.openFile)
  const markClean = useWorkspaceStore((s) => s.markClean)
  const closeTab = useWorkspaceStore((s) => s.closeTab)

  const activeTab = tabs.find((tb) => tb.path === activePath) ?? null
  const content = tabContent(activeTab ?? undefined)
  const optimize = useOptimizePrompt()
  const image = useImagePaste()

  // Imperative editor commands handed back by CodeEditor on mount; used by the
  // right-click menu to drive copy/cut/paste/etc.
  const commandsRef = useRef<EditorCommands | null>(null)
  // Drag-over state lives here (parent) so the editor can stay a dumb view.
  const [dropActive, setDropActive] = useState(false)

  const isDraft = activeTab?.path.startsWith(DRAFT_PREFIX) ?? false

  // Auto-save debounce: when autoSave is on, save 1.5s after the last edit.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  // Auto-resolve optimize when config says overwrite or keep (skip the dialog).
  useEffect(() => {
    if (optimize.pending && optimizeDefaultAction !== 'ask') {
      void optimize.resolve(optimizeDefaultAction)
    }
  }, [optimize.pending, optimizeDefaultAction, optimize])

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

  const handleSave = async (): Promise<void> => {
    if (!activeTab) return
    if (isDraft) {
      // Draft tabs exist only in memory; guide the user to a real file first.
      window.alert(t('editor.draftSaveHint'))
      return
    }
    const toWrite = activeTab.dirtyContent ?? activeTab.savedContent
    await writeFile(activeTab.path, toWrite)
    markClean(activeTab.path)
  }

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

  const optimizeSelection = useCallback(async (): Promise<void> => {
    const cmds = commandsRef.current
    if (!cmds || !activeTab) return
    const selectedText = cmds.getSelectionText()
    if (!selectedText.trim()) return
    setSelectionOptimize({ busy: true, streaming: '', error: null })
    try {
      const optimized = await optimizePrompt(selectedText, (delta) => {
        setSelectionOptimize((s) => (s.busy ? { ...s, streaming: (s.streaming ?? '') + delta } : s))
      })
      setSelectionOptimize({ busy: false, streaming: null, error: null })
      // Splice the optimized text back into the document, replacing the
      // original selection in place.
      cmds.replaceSelection(optimized)
    } catch (err) {
      setSelectionOptimize({ busy: false, streaming: null, error: t('ai.error', { message: (err as Error).message }) })
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
      const cmds = commandsRef.current
      const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
      const items: MenuItemDef[] = [
        {
          id: 'cut',
          label: t('editor.cut'),
          shortcut: `${mod}X`,
          disabled: !hasSelection,
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
          onClick: () => cmds?.paste(),
          separatorAfter: true
        },
        {
          id: 'paste-image',
          label: t('editor.pasteImage'),
          onClick: () => void pickImage()
        },
        {
          id: 'optimize-selection',
          label: t('editor.optimizeSelection'),
          disabled: !hasSelection || !aiReady,
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
          onClick: () => cmds?.undo()
        },
        {
          id: 'redo',
          label: t('editor.redo'),
          shortcut: `Shift+${mod}Z`,
          onClick: () => cmds?.redo()
        }
      ]
      openMenu(e, items)
    },
    [aiReady, openMenu, optimizeSelection, pickImage, t]
  )

  const hasOpenTab = activeTab !== null
  const busy = optimize.busy || image.busy || selectionOptimize.busy
  const aiError = optimize.error ?? image.error ?? selectionOptimize.error

  // Stats for the status bar: line count + char count of the active document.
  const stats = useMemo(() => {
    if (!content) return { lines: 0, chars: 0 }
    const lines = content.split('\n').length
    const chars = content.length
    return { lines, chars }
  }, [content])

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-base">
      {/* AI action bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!aiReady || !hasOpenTab || busy}
          title={t('ai.optimizeHelp')}
          onClick={() => void optimize.run()}
        >
          <SparkleIcon />
          {busy ? t('ai.working') : t('ai.optimize')}
        </Button>
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

      {!hasOpenTab ? (
        <EmptyState onDropImage={handleImageFile} />
      ) : (
        <>
          <TabBar onRequestClose={requestCloseTab} />
          <div className="relative flex min-h-0 flex-1 flex-col">
            {showPreview ? (
              <SplitPane
                left={
                  <CodeEditor
                    key={activeTab.path}
                    value={content}
                    onChange={(v) => edit(activeTab.path, v)}
                    onSave={() => void handleSave()}
                    onPasteImage={handleImageFile}
                    onDropImage={handleImageFile}
                    onContextMenu={handleContextMenu}
                    dropActive={dropActive}
                    onDropActiveChange={setDropActive}
                    dropHint={t('editor.dropImageHint')}
                    registerCommands={(cmds) => {
                      commandsRef.current = cmds
                    }}
                  />
                }
                right={<MarkdownPreview source={content} />}
              />
            ) : (
              <CodeEditor
                key={activeTab.path}
                value={content}
                onChange={(v) => edit(activeTab.path, v)}
                onSave={() => void handleSave()}
                onPasteImage={handleImageFile}
                onDropImage={handleImageFile}
                onContextMenu={handleContextMenu}
                dropActive={dropActive}
                onDropActiveChange={setDropActive}
                dropHint={t('editor.dropImageHint')}
                registerCommands={(cmds) => {
                  commandsRef.current = cmds
                }}
              />
            )}
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
        const files = e.dataTransfer.files
        if (!files || files.length === 0) return
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith('image/')) {
            e.preventDefault()
            setDragOver(false)
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

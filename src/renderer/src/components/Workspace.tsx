import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore, tabContent, type Tab } from '../store/workspace'
import { useWorkspaceRoot } from '../hooks/useWorkspaceRoot'
import TabBar from './EditorPane/TabBar'
import CodeEditor, { type EditorCommands } from './EditorPane/CodeEditor'
import SplitPane from './EditorPane/SplitPane'
import MarkdownPreview from './PreviewPane/MarkdownPreview'
import EmptyState from './Workspace/EmptyState'
import StreamingPreview from './Workspace/StreamingPreview'
import { SparkleIcon, FeatherIcon, ImageIcon, SettingsIcon } from './ui/icons'
import { Button } from './ui/Button'
import ChoiceDialog from './ui/ChoiceDialog'
import { useOptimizePrompt } from '../features/useOptimizePrompt'
import { useSaveFlows } from '../features/useSaveFlows'
import { useTabCloseConfirm } from '../features/useTabCloseConfirm'
import { useSelectionAi } from '../features/useSelectionAi'
import { useImagePromptFlow } from '../features/useImagePromptFlow'
import { useEditorContextMenu } from '../features/useEditorContextMenu'
import { isDraftPath } from '../services/drafts'

interface WorkspaceProps {
  onOpenSettings: () => void
}

/**
 * Workspace layout and composition. Behavioral flows live in feature hooks:
 * persistence (`useSaveFlows`), close confirmation (`useTabCloseConfirm`),
 * AI actions (`useOptimizePrompt`, `useSelectionAi`, `useImagePromptFlow`) and
 * the editor context menu (`useEditorContextMenu`).
 */
export default function Workspace({ onOpenSettings }: WorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const aiReady = useConfigStore((s) => s.aiReady())
  const optimizeDefaultAction = useConfigStore((s) => s.config.app.optimizeDefaultAction)
  const showOptimizeWholeFile = useConfigStore((s) => s.config.app.showOptimizeWholeFile)
  const showPreview = useConfigStore((s) => s.config.app.showPreview)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const pendingRenamePath = useWorkspaceStore((s) => s.pendingRenamePath)
  const pendingReveal = useWorkspaceStore((s) => s.pendingReveal)
  const edit = useWorkspaceStore((s) => s.edit)
  const setActive = useWorkspaceStore((s) => s.setActive)
  const workspaceRoot = useWorkspaceRoot()

  const activeTab = tabs.find((tb) => tb.path === activePath) ?? null
  const content = tabContent(activeTab ?? undefined)
  const optimize = useOptimizePrompt()
  const { saveTab, saveError } = useSaveFlows()
  const { pendingCloseTabs, requestCloseTab, requestCloseTabs, resolveCloseTabs } =
    useTabCloseConfirm()

  // Imperative editor commands for each tab, keyed by path. Used by the
  // right-click context menu and to focus the editor on tab switch.
  const commandsMapRef = useRef<Map<string, EditorCommands>>(new Map())
  const {
    selectionOptimize,
    selectionPolish,
    optimizeSelection,
    polishSelection,
    abortSelectionOptimize,
    abortSelectionPolish
  } = useSelectionAi(commandsMapRef)
  const { image, handleImageFile, handleConvertImage, convertError, pickImage, fileInputRef } =
    useImagePromptFlow()
  const handleContextMenu = useEditorContextMenu(commandsMapRef, { optimizeSelection, pickImage })

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

  const hasOpenTab = activeTab !== null
  const busy =
    optimize.busy || image.busy || selectionOptimize.busy || selectionPolish.busy
  const aiError =
    optimize.error ??
    image.error ??
    convertError ??
    selectionOptimize.error ??
    selectionPolish.error ??
    saveError

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
              if (selectionOptimize.busy) abortSelectionOptimize()
              if (selectionPolish.busy) abortSelectionPolish()
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

      {/* Live streaming previews while AI operations are producing text. */}
      {optimize.streaming !== null && <StreamingPreview streaming={optimize.streaming} />}
      {selectionOptimize.streaming !== null && (
        <StreamingPreview streaming={selectionOptimize.streaming} />
      )}
      {selectionPolish.streaming !== null && (
        <StreamingPreview streaming={selectionPolish.streaming} />
      )}

      {!hasOpenTab ? (
        <EmptyState onDropImage={handleImageFile} />
      ) : (
        <>
          <TabBar onRequestClose={requestCloseTab} onRequestCloseTabs={requestCloseTabs} />
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
                  revealTarget={
                    pendingReveal && pendingReveal.path === tab.path ? pendingReveal : undefined
                  }
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

      {/* Unsaved changes confirmation when closing dirty tabs (single or batch). */}
      {pendingCloseTabs && (
        <CloseTabsDialog pendingTabs={pendingCloseTabs} onResolve={resolveCloseTabs} />
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

/**
 * Dirty-tab close confirmation — keeps "save / discard / cancel" semantics
 * for single closes and batch closes (close-right / close-others). Draft tabs
 * have no backing file, so for them only discard / cancel is offered.
 */
function CloseTabsDialog({
  pendingTabs,
  onResolve
}: {
  pendingTabs: Tab[]
  onResolve: (action: 'save' | 'discard' | 'cancel') => Promise<void>
}): JSX.Element {
  const { t } = useTranslation()
  const isSingle = pendingTabs.length === 1
  const single = pendingTabs[0]
  const hasDraft = pendingTabs.some((tb) => isDraftPath(tb.path))
  const hasSavable = pendingTabs.some((tb) => !isDraftPath(tb.path))

  let description: string
  if (isSingle && isDraftPath(single.path)) {
    description = t('editor.draftCloseMessage', { name: single.name })
  } else if (isSingle) {
    description = t('editor.unsavedChangesMessage', { name: single.name })
  } else {
    description = t('editor.unsavedTabsMessage', {
      count: pendingTabs.length,
      names: pendingTabs.map((tb) => tb.name).join('、')
    })
    if (hasDraft) description += `\n${t('editor.draftNotSavedHint')}`
  }

  const options: { label: string; value: 'save' | 'discard' | 'cancel'; variant: 'primary' | 'danger' | 'secondary' }[] = []
  // Drafts cannot be saved (memory-only) — offer "save" only for real files.
  if (hasSavable) {
    options.push({
      label: isSingle ? t('editor.saveAndClose') : t('editor.saveAllAndClose'),
      value: 'save',
      variant: 'primary'
    })
  }
  options.push({
    label: isSingle ? t('editor.discardChanges') : t('editor.discardAll'),
    value: 'discard',
    variant: 'danger'
  })
  options.push({ label: t('common.cancel'), value: 'cancel', variant: 'secondary' })

  return (
    <ChoiceDialog
      title={t('editor.unsavedChanges')}
      description={description}
      dismissible
      onCancel={() => void onResolve('cancel')}
      options={options}
      onChoose={(v) => { void onResolve(v as 'save' | 'discard' | 'cancel') }}
    />
  )
}

import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'

const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: 'rgb(var(--color-editor-heading))',
    fontWeight: '700'
  },
  {
    tag: [tags.contentSeparator, tags.quote, tags.punctuation],
    color: 'rgb(var(--color-editor-markup))',
    fontWeight: '600'
  },
  {
    tag: [tags.emphasis, tags.strong, tags.strikethrough],
    color: 'rgb(var(--color-text))'
  },
  {
    tag: [tags.link, tags.url],
    color: 'rgb(var(--color-editor-link))',
    textDecoration: 'underline'
  },
  {
    tag: [tags.monospace, tags.string, tags.atom],
    color: 'rgb(var(--color-editor-code))'
  },
  {
    tag: [tags.comment, tags.meta],
    color: 'rgb(var(--color-editor-markup))'
  }
])

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  /** Save handler bound to Cmd/Ctrl+S. */
  onSave: () => void
  /**
   * When true, the editor is read-only — no edits are allowed.
   */
  readOnly?: boolean
  /**
   * Called when the user pastes an image inside the editor. The image is NOT
   * inserted into the document — returning it here lets the caller (the image
   * → prompt feature) intercept it. Wired via CodeMirror's own DOM-event
   * handler so we run as part of CM's paste handling, before it could swallow
   * or rewrite the clipboard data.
   */
  onPasteImage?: (file: File) => void
  /**
   * Called when the user drops an image onto the editor. Same flow as paste —
   * the image is handed off to the image→prompt feature rather than inserted.
   */
  onDropImage?: (file: File) => void
  /**
   * Right-click inside the editor. `hasSelection` tells the caller whether the
   * caret has an active selection so it can build appropriate menu items.
   */
  onContextMenu?: (e: React.MouseEvent, hasSelection: boolean) => void
  /** Whether a drag-with-image is currently hovering the editor (visual hint). */
  dropActive: boolean
  /** Notifies parent that the drag-hover state changed. */
  onDropActiveChange: (active: boolean) => void
  /** Hint text shown over the editor while a drag is in progress. */
  dropHint?: string
  /**
   * Called once on mount with a set of editor-command functions (copy/cut/
   * paste/selectAll/undo/redo + hasSelection). The parent stores them to wire
   * up the right-click context menu items.
   */
  registerCommands?: (cmds: EditorCommands) => void
  /** Called when the user presses Ctrl+W / Cmd+W — close the active tab. */
  onCloseTab?: () => void
  /** Called when the user presses Ctrl+N / Cmd+N — create a new file. */
  onNewFile?: () => void
  /** Called when the user presses Ctrl+PageDown or Ctrl+Tab — next tab. */
  onNextTab?: () => void
  /** Called when the user presses Ctrl+PageUp or Ctrl+Shift+Tab — previous tab. */
  onPrevTab?: () => void
  /** Called when the text selection changes (hasSelection flag). */
  onSelectionChange?: (hasSelection: boolean) => void
}

/** Imperative editor actions exposed to the parent for the context menu. */
export interface EditorCommands {
  copy: () => void
  cut: () => void
  paste: () => void
  selectAll: () => void
  undo: () => void
  redo: () => void
  hasSelection: () => boolean
  /** Returns the currently-selected text (empty string if no selection). */
  getSelectionText: () => string
  /** Replaces the current selection with `text` (inserts at caret if none). */
  replaceSelection: (text: string) => void
  /** Focus the editor (called when its tab becomes active). */
  focus: () => void
}

/**
 * CodeMirror 6 wrapper. Edits are reported via `onChange` and saved via
 * `onSave` (Cmd/Ctrl+S). The `value` prop is treated as the source of truth —
 * external changes (AI overwrites, file sync) are synced into the editor.
 *
 * Each tab keeps its own editor instance alive (parent controls visibility via
 * the container), which preserves per-tab undo history across tab switches.
 */
export default function CodeEditor({
  value,
  onChange,
  onSave,
  readOnly,
  onPasteImage,
  onDropImage,
  onContextMenu,
  dropActive,
  onDropActiveChange,
  dropHint,
  registerCommands,
  onCloseTab,
  onNewFile,
  onNextTab,
  onPrevTab,
  onSelectionChange
}: CodeEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Keep latest handlers in refs so the editor isn't rebuilt on every keystroke.
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const readOnlyRef = useRef(readOnly)
  const onPasteImageRef = useRef(onPasteImage)
  const onDropImageRef = useRef(onDropImage)
  const onContextMenuRef = useRef(onContextMenu)
  const onDropActiveChangeRef = useRef(onDropActiveChange)
  const registerCommandsRef = useRef(registerCommands)
  const onCloseTabRef = useRef(onCloseTab)
  const onNewFileRef = useRef(onNewFile)
  const onNextTabRef = useRef(onNextTab)
  const onPrevTabRef = useRef(onPrevTab)
  const onSelectionChangeRef = useRef(onSelectionChange)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  readOnlyRef.current = readOnly
  onPasteImageRef.current = onPasteImage
  onDropImageRef.current = onDropImage
  onContextMenuRef.current = onContextMenu
  onDropActiveChangeRef.current = onDropActiveChange
  registerCommandsRef.current = registerCommands
  onCloseTabRef.current = onCloseTab
  onNewFileRef.current = onNewFile
  onNextTabRef.current = onNextTab
  onPrevTabRef.current = onPrevTab
  onSelectionChangeRef.current = onSelectionChange
  // Track the value currently reflected in the editor so we only dispatch a
  // programmatic update when the prop genuinely diverges (e.g. AI overwrite,
  // external file change) — never on the user's own typing, which already
  // updated the doc and would otherwise create a redundant/caret-jumping edit.
  const valueRef = useRef(value)

  useEffect(() => {
    if (!hostRef.current) return

    const workspaceKeymap = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSaveRef.current()
          return true
        }
      },
      {
        key: 'Mod-w',
        preventDefault: true,
        run: () => {
          onCloseTabRef.current?.()
          return true
        }
      },
      {
        key: 'Mod-n',
        preventDefault: true,
        run: () => {
          onNewFileRef.current?.()
          return true
        }
      },
      {
        key: 'Ctrl-PageDown',
        preventDefault: true,
        run: () => {
          onNextTabRef.current?.()
          return true
        }
      },
      {
        key: 'Ctrl-Tab',
        preventDefault: true,
        run: () => {
          onNextTabRef.current?.()
          return true
        }
      },
      {
        key: 'Ctrl-PageUp',
        preventDefault: true,
        run: () => {
          onPrevTabRef.current?.()
          return true
        }
      },
      {
        key: 'Ctrl-Shift-Tab',
        preventDefault: true,
        run: () => {
          onPrevTabRef.current?.()
          return true
        }
      }
    ])

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const next = update.state.doc.toString()
        valueRef.current = next
        onChangeRef.current(next)
      }
      if (update.selectionSet) {
        const hasSel = !update.state.selection.main.empty
        onSelectionChangeRef.current?.(hasSel)
      }
    })

    const theme = EditorView.theme({
      '&': {
        backgroundColor: 'transparent',
        color: 'rgb(var(--color-text))',
        height: '100%',
        fontSize: '14px'
      },
      '.cm-content': { caretColor: 'rgb(var(--color-accent))', padding: '16px 0' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'rgb(var(--color-text-muted))',
        border: 'none'
      },
      '.cm-activeLine': { backgroundColor: 'rgb(var(--color-bg-subtle) / 0.5)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      '.cm-cursor': { borderLeftColor: 'rgb(var(--color-accent))' },
      '&.cm-focused': { outline: 'none' }
    })

    // Intercept image pastes INSIDE CodeMirror. Registering the handler as a
    // CM extension means we participate in CM's own paste pipeline and can
    // preventDefault before CM swallows / rewrites the clipboard — which is the
    // bug we hit when the listener lived on the wrapper div. Text/HTML pastes
    // are left untouched (return false → CM handles them normally).
    const pasteImageHandler = EditorView.domEventHandlers({
      paste(event, _view) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) {
              event.preventDefault()
              onPasteImageRef.current?.(file)
              return true
            }
          }
        }
        return false
      }
    })

    // Image drag-and-drop, handled the same way as paste: intercept inside CM
    // so we can decide before the browser/CM does anything with it. A drop is
    // only claimed when the payload carries an image file; everything else
    // (text, files of other types) falls through to default behaviour.
    const dropHandler = EditorView.domEventHandlers({
      dragover(event, _view) {
        if (event.dataTransfer?.types.includes('Files')) {
          // Must preventDefault on dragover or the browser won't allow a drop.
          event.preventDefault()
          return true
        }
        return false
      },
      dragenter(event, _view) {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault()
          onDropActiveChangeRef.current(true)
          return true
        }
        return false
      },
      dragleave(event, _view) {
        // Only clear when leaving the editor content, not when moving between
        // child elements (relatedTarget handles that).
        if (!event.relatedTarget) {
          onDropActiveChangeRef.current(false)
        }
        return false
      },
      drop(event, _view) {
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (file.type.startsWith('image/')) {
            event.preventDefault()
            onDropActiveChangeRef.current(false)
            onDropImageRef.current?.(file)
            return true
          }
        }
        onDropActiveChangeRef.current(false)
        return false
      }
    })

    // Right-click context menu. Built inside CM so we have direct access to the
    // view + selection for Copy/Cut/etc., and so we can preventDefault before
    // the browser shows its native menu. The actual menu items are constructed
    // by the parent (which owns the ContextMenu provider + i18n); we hand it a
    // synthetic-ish React.MouseEvent-like object built from the DOM event.
    const contextMenuHandler = EditorView.domEventHandlers({
      contextmenu(event, view) {
        event.preventDefault()
        const hasSelection = !view.state.selection.main.empty
        // The parent's open() expects a React.MouseEvent for coordinates; a DOM
        // MouseEvent carries clientX/clientY and preventDefault/stopPropagation
        // so it satisfies the shape we use.
        onContextMenuRef.current?.(event as unknown as React.MouseEvent, hasSelection)
        return true
      }
    })

    // When readOnly, prevent editing in the editor.
    const readOnlyExt: Extension[] = readOnly ? [EditorView.editable.of(false)] : []

    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      bracketMatching(),
      highlightActiveLine(),
      syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      search({ top: true }),
      workspaceKeymap,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      updateListener,
      pasteImageHandler,
      dropHandler,
      contextMenuHandler,
      theme,
      EditorView.lineWrapping,
      ...readOnlyExt
    ]

    const state = EditorState.create({
      doc: value,
      extensions
    })

    const view = new EditorView({
      state,
      parent: hostRef.current
    })
    viewRef.current = view
    valueRef.current = value

    // Expose imperative editor actions so the parent's right-click menu can
    // drive copy/cut/paste/etc. against the live view. Each reads current
    // state at call-time, so they stay correct even as the doc changes.
    registerCommandsRef.current?.({
      copy: () => {
        const v = viewRef.current
        if (!v) return
        const { from, to } = v.state.selection.main
        if (from === to) return
        const text = v.state.sliceDoc(from, to)
        void navigator.clipboard?.writeText(text)
      },
      cut: () => {
        const v = viewRef.current
        if (!v) return
        const { from, to } = v.state.selection.main
        if (from === to) return
        const text = v.state.sliceDoc(from, to)
        void navigator.clipboard?.writeText(text)
        v.dispatch({ changes: { from, to, insert: '' } })
      },
      paste: () => {
        const v = viewRef.current
        if (!v) return
        void navigator.clipboard?.readText().then((text) => {
          if (text === undefined || text === null || text === '') return
          const sel = viewRef.current?.state.selection.main
          if (!sel) return
          viewRef.current?.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } })
        })
      },
      selectAll: () => {
        const v = viewRef.current
        if (!v) return
        const end = v.state.doc.length
        v.dispatch({ selection: { anchor: 0, head: end } })
      },
      undo: () => {
        const v = viewRef.current
        if (v) undo(v)
      },
      redo: () => {
        const v = viewRef.current
        if (v) redo(v)
      },
      hasSelection: () => {
        const v = viewRef.current
        return v ? !v.state.selection.main.empty : false
      },
      getSelectionText: () => {
        const v = viewRef.current
        if (!v) return ''
        const { from, to } = v.state.selection.main
        if (from === to) return ''
        return v.state.sliceDoc(from, to)
      },
      replaceSelection: (text: string) => {
        const v = viewRef.current
        if (!v) return
        const sel = v.state.selection.main
        v.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length }
        })
      },
      focus: () => {
        viewRef.current?.focus()
      }
    })

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value changes (AI overwrite, reload, undo-from-store, …)
  // into the editor without rebuilding it. Skipped when the value already
  // matches (covers both no-op and the user's own keystroke round-trip).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === valueRef.current) return
    if (value === view.state.doc.toString()) {
      valueRef.current = value
      return
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    })
    valueRef.current = value
  }, [value])

  return (
    <div className="relative h-full overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" />
      {dropActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent-soft/20 ring-2 ring-inset ring-accent">
          {dropHint && (
            <span className="rounded-md bg-bg-surface px-3 py-1.5 text-sm text-text shadow-md">
              {dropHint}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '../../store/workspace'
import { createFile } from '../../services/fileOps'
import { insertNode } from '../../services/treeOps'

interface Props {
  /** Directory where the new Markdown file will be created on commit. */
  dir: string
}

/**
 * Inline input for creating a new Markdown file without a default name.
 * Starts empty and focused. Cancels (no file created) when committed with an
 * empty value; creates the file when committed with a non-empty name
 * (Enter or click-away/blur). Escape cancels.
 */
export default function NewFileInput({ dir }: Props): JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Track mount state so we don't commit on an unmount-triggered blur.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Focus the empty input as soon as it appears.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const clear = useCallback(() => {
    useWorkspaceStore.getState().clearPendingNewFile()
  }, [])

  const commit = useCallback(async (): Promise<void> => {
    if (busyRef.current) return
    const name = value.trim()
    if (!name) {
      clear()
      return
    }
    busyRef.current = true
    setError(null)
    try {
      const path = await createFile(dir, name)
      const fileName = path.split('/').pop() ?? ''
      const state = useWorkspaceStore.getState()
      if (state.tree) {
        state.setTree(insertNode(state.tree, dir, { path, name: fileName, kind: 'file' }))
      }
      // Only open the new file when the user is still on the input (Enter) or
      // clicked a neutral area (editor / preview). If they clicked a tree-row
      // button, that row's own click handler decides which file opens — don't
      // let this late-arriving commit override it.
      const el = document.activeElement as HTMLElement | null
      const clickedTreeRow = !!el?.closest('button')
      if (!clickedTreeRow) {
        state.openFile(path, fileName, '')
      }
    } catch (err) {
      // Keep the input open + show the reason (e.g. invalid chars on Windows)
      // instead of silently dropping the user's typed name.
      setError((err as Error).message)
      busyRef.current = false
      return
    }
    clear()
    busyRef.current = false
  }, [dir, value, clear])

  const handleBlur = (): void => {
    if (mountedRef.current) void commit()
  }

  return (
    <div>
      <input
        ref={inputRef}
        value={value}
        placeholder={t('tree.newFilePlaceholder')}
        className="w-full rounded border border-accent bg-bg-base px-1.5 py-1 text-[13px] outline-none placeholder:text-text-muted"
        onChange={(e) => {
          setValue(e.target.value)
          if (error) setError(null)
        }}
        onBlur={handleBlur}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Ignore keys used by IME composition (pinyin etc.): Enter confirms
          // a candidate, Escape cancels it — neither should commit or cancel
          // the new-file flow mid-composition.
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            clear()
          }
        }}
      />
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  )
}

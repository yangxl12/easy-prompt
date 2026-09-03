import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReplaceTarget, SearchFileResult, SearchMatch } from '@shared/types'
import { useGlobalSearch } from '../features/useGlobalSearch'
import { useWorkspaceRoot } from '../hooks/useWorkspaceRoot'
import { replaceMatches, splitMatchSegments } from '../services/search'
import { readFileSync } from '../services/fileOps'
import { useWorkspaceStore } from '../store/workspace'
import { relativeDirFrom } from '../services/pathUtils'
import { ChevronDownIcon, CloseIcon, FileIcon, SearchIcon } from './ui/icons'

interface GlobalSearchPanelProps {
  onClose: () => void
}

interface FlatMatch {
  file: SearchFileResult
  match: SearchMatch
}

/**
 * Workspace-wide search, docked under the title bar (VS Code style): one input
 * plus match options on top, a file-grouped result list below. Clicking a hit
 * opens the note and selects the matched range in the editor.
 *
 * Keyboard nav mirrors VS Code's search: ↑/↓ move the focused hit, Enter opens
 * it, and F3 (Shift+F3) opens the next (previous) one. The focused row auto-
 * scrolls into view so a long result set never strands the caret.
 *
 * An optional replace mode mirrors VS Code too: expand the "替换" row, type a
 * replacement, then replace a single hit or every hit at once.
 */
export default function GlobalSearchPanel({ onClose }: GlobalSearchPanelProps): JSX.Element {
  const { t } = useTranslation()
  const root = useWorkspaceRoot()
  const { query, setQuery, options, toggleOption, result, searching, error, openMatch, clear, refresh } =
    useGlobalSearch()
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({})
  const [replaceMode, setReplaceMode] = useState(false)
  const [replaceValue, setReplaceValue] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [replaceMsg, setReplaceMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusedRef = useRef<HTMLButtonElement>(null)
  // Index of the currently focused hit within the *visible* (non-collapsed) rows.
  const [focusIndex, setFocusIndex] = useState(0)

  // Focus the field as soon as the panel opens — searching is the only thing
  // the user wants to do here.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Every match, in display order, only counting rows that are actually shown
  // (a collapsed file contributes none). Used for both navigation and indexing.
  const visibleMatches = useMemo<FlatMatch[]>(() => {
    const list: FlatMatch[] = []
    if (!result) return list
    for (const file of result.files) {
      if (collapsedPaths[file.path]) continue
      for (const match of file.matches) list.push({ file, match })
    }
    return list
  }, [result, collapsedPaths])

  // Map "file path :: match index within file" → position in the visible list.
  const matchIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = 0; i < visibleMatches.length; i++) {
      const { file, match } = visibleMatches[i]
      const pos = file.matches.indexOf(match)
      map.set(`${file.path}::${pos}`, i)
    }
    return map
  }, [visibleMatches])

  // Any new result set starts focus at the top.
  useEffect(() => {
    setFocusIndex(0)
  }, [result])

  // Clear the transient replace status whenever a fresh query runs.
  useEffect(() => {
    setReplaceMsg(null)
  }, [query])

  // Keep the focused row in view as the user arrows through results.
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  const visibleCount = visibleMatches.length

  const goTo = (next: number): void => {
    if (visibleCount === 0) return
    setFocusIndex(Math.max(0, Math.min(next, visibleCount - 1)))
  }

  const openAt = (index: number): void => {
    const item = visibleMatches[index]
    if (item) openMatch(item.file, item.match)
  }

  const handleSectionKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (visibleCount === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      goTo(focusIndex + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      goTo(focusIndex - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openAt(focusIndex)
    } else if (e.key === 'F3') {
      e.preventDefault()
      const target = Math.max(0, Math.min(e.shiftKey ? focusIndex - 1 : focusIndex + 1, visibleCount - 1))
      setFocusIndex(target)
      openAt(target)
    }
  }

  /** Replace either the given hits or (when omitted) every match in the query. */
  const doReplace = async (targets?: ReplaceTarget[]): Promise<void> => {
    if (!result || replacing) return
    setReplacing(true)
    try {
      const res = await replaceMatches({
        query: query.trim(),
        caseSensitive: options.caseSensitive,
        wholeWord: options.wholeWord,
        useRegex: options.useRegex,
        replacement: replaceValue,
        targets
      })
      // Reload any open tab whose backing file just changed on disk.
      const store = useWorkspaceStore.getState()
      for (const p of res.paths) {
        if (!store.tabs.some((tab) => tab.path === p)) continue
        try {
          const content = await readFileSync(p)
          store.setSaved(p, content)
        } catch {
          // Tab stays as-is if the reload fails; the disk already holds the new text.
        }
      }
      refresh()
      setReplaceMsg(
        res.replaced > 0
          ? t('globalSearch.replaced', { count: res.replaced, files: res.files })
          : t('globalSearch.noResults')
      )
    } catch {
      setReplaceMsg(t('globalSearch.failed'))
    } finally {
      setReplacing(false)
    }
  }

  const toggleFile = (path: string): void => {
    setCollapsedPaths((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  const showEmptyState = !query.trim() && !result

  return (
    <section
      className="flex max-h-[55vh] min-h-0 shrink-0 flex-col border-b border-border bg-bg-surface"
      onKeyDown={handleSectionKeyDown}
    >
      {/* Search input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex min-w-0 flex-1 items-center">
          <span className="pointer-events-none absolute left-2 text-text-muted">
            <SearchIcon width={14} height={14} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('globalSearch.placeholder')}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-bg-base py-1.5 pl-8 pr-8 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          {query !== '' && (
            <button
              onClick={clear}
              title={t('globalSearch.clear')}
              className="absolute right-2 rounded p-0.5 text-text-muted hover:bg-bg-subtle hover:text-text"
            >
              <CloseIcon width={13} height={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <OptionToggle
            label="Aa"
            title={t('globalSearch.caseSensitive')}
            active={options.caseSensitive}
            onClick={() => toggleOption('caseSensitive')}
          />
          <OptionToggle
            label="[ab]"
            title={t('globalSearch.wholeWord')}
            active={options.wholeWord}
            onClick={() => toggleOption('wholeWord')}
          />
          <OptionToggle
            label=".*"
            title={t('globalSearch.regex')}
            active={options.useRegex}
            onClick={() => toggleOption('useRegex')}
          />
          <button
            onClick={() => setReplaceMode((v) => !v)}
            title={t('globalSearch.replaceToggle')}
            className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
              replaceMode
                ? 'border-accent bg-accent-soft text-text'
                : 'border-border text-text-muted hover:bg-bg-subtle hover:text-text'
            }`}
          >
            {t('globalSearch.replaceToggle')}
          </button>
        </div>

        {searching && <span className="text-xs text-text-muted">{t('globalSearch.searching')}</span>}
        {!searching && result && (
          <span className="whitespace-nowrap text-xs text-text-muted">
            {t('globalSearch.resultCount', {
              files: result.files.length,
              matches: result.totalMatches
            })}
          </span>
        )}

        <button
          onClick={onClose}
          title={t('common.close')}
          className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>

      {/* Replace row */}
      {replaceMode && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <span className="pointer-events-none absolute left-2 text-text-muted">
              <SearchIcon width={14} height={14} className="rotate-90" />
            </span>
            <input
              value={replaceValue}
              onChange={(e) => setReplaceValue(e.target.value)}
              placeholder={t('globalSearch.replacePlaceholder')}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-bg-base py-1.5 pl-8 pr-3 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
          <button
            onClick={() => void doReplace()}
            disabled={replacing || !query.trim()}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-50"
          >
            {t('globalSearch.replaceAll')}
          </button>
        </div>
      )}

      {/* Navigation hint + transient replace status */}
      {!error && (
        <div className="flex items-center justify-between px-3 pb-1 text-[11px] text-text-muted">
          <span>{t('globalSearch.navHint')}</span>
          {replaceMsg && <span className="text-accent">{replaceMsg}</span>}
        </div>
      )}

      {/* Result list */}
      <div className="min-h-0 flex-1 overflow-auto pb-1">
        {error === 'invalidRegex' && <PanelMessage text={t('globalSearch.invalidRegex')} />}
        {error === 'noWorkspace' && <PanelMessage text={t('globalSearch.noWorkspace')} />}
        {error === 'failed' && <PanelMessage text={t('globalSearch.failed')} />}

        {!error && showEmptyState && <PanelMessage text={t('globalSearch.hint')} />}

        {!error && !searching && result && result.files.length === 0 && query.trim() !== '' && (
          <PanelMessage text={t('globalSearch.noResults')} />
        )}

        {result?.files.map((file) => {
          const collapsed = collapsedPaths[file.path] === true
          return (
            <div key={file.path}>
              <button
                onClick={() => toggleFile(file.path)}
                className="sticky top-0 flex w-full items-center gap-1.5 bg-bg-surface px-3 py-1 text-left text-xs hover:bg-bg-subtle"
              >
                <span
                  className={`shrink-0 text-text-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
                >
                  <ChevronDownIcon width={12} height={12} />
                </span>
                <FileIcon width={12} height={12} className="shrink-0 text-text-muted" />
                <span className="shrink-0 font-medium text-text">{file.name}</span>
                {relativeDirFrom(root, file.path) !== '' && (
                  <span className="truncate text-text-muted">
                    {relativeDirFrom(root, file.path)}
                  </span>
                )}
                <span className="ml-auto shrink-0 rounded-full bg-bg-subtle px-1.5 text-[11px] text-text-muted">
                  {file.matches.length}
                </span>
              </button>

              {!collapsed &&
                file.matches.map((match, index) => {
                  const flatIndex = matchIndexMap.get(`${file.path}::${index}`) ?? -1
                  const isFocused = flatIndex === focusIndex && flatIndex >= 0
                  return (
                    <div
                      key={`${match.line}:${match.column}:${index}`}
                      className={`flex w-full items-baseline gap-2 pl-8 pr-2 text-left text-xs ${
                        isFocused ? 'bg-accent-soft' : 'hover:bg-bg-subtle'
                      }`}
                    >
                      <button
                        ref={isFocused ? focusedRef : undefined}
                        onClick={() => {
                          if (flatIndex >= 0) setFocusIndex(flatIndex)
                          openMatch(file, match)
                        }}
                        title={t('globalSearch.openMatch')}
                        className="flex min-w-0 flex-1 items-baseline gap-2 py-[3px] text-left"
                      >
                        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-text-muted">
                          {match.line}:{match.column + 1}
                        </span>
                        <span className="truncate font-mono text-text">
                          {splitMatchSegments(match.lineText, match.column, match.length).map(
                            (segment, i) =>
                              segment.hit ? (
                                <mark
                                  key={i}
                                  className="rounded-sm bg-accent px-0.5 font-semibold text-text"
                                >
                                  {segment.text}
                                </mark>
                              ) : (
                                <span key={i}>{segment.text}</span>
                              )
                          )}
                        </span>
                      </button>

                      {replaceMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void doReplace([
                              { path: file.path, line: match.line, column: match.column, length: match.length }
                            ])
                          }}
                          disabled={replacing}
                          title={t('globalSearch.replaceOne')}
                          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-bg-base hover:text-text disabled:opacity-50"
                        >
                          {t('globalSearch.replaceOne')}
                        </button>
                      )}
                    </div>
                  )
                })}
            </div>
          )
        })}

        {result?.truncated && (
          <div className="px-3 py-1 text-[11px] text-text-muted">
            {t('globalSearch.truncated', { scanned: result.scannedFiles })}
          </div>
        )}
      </div>
    </section>
  )
}

/** Small `[ab]`-style option chip next to the search input. */
function OptionToggle({
  label,
  title,
  active,
  onClick
}: {
  label: string
  title: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
        active
          ? 'border-accent bg-accent-soft text-text'
          : 'border-border text-text-muted hover:bg-bg-subtle hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

function PanelMessage({ text }: { text: string }): JSX.Element {
  return <div className="px-3 py-2 text-xs text-text-muted">{text}</div>
}

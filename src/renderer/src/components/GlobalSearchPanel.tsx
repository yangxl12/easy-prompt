import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchFileResult, SearchMatch } from '@shared/types'
import { useGlobalSearch } from '../features/useGlobalSearch'
import { useWorkspaceRoot } from '../hooks/useWorkspaceRoot'
import { splitMatchSegments } from '../services/search'
import { relativeDirFrom } from '../services/pathUtils'
import { ChevronDownIcon, CloseIcon, FileIcon, SearchIcon } from './ui/icons'

interface GlobalSearchPanelProps {
  onClose: () => void
}

/**
 * Workspace-wide search, docked under the title bar (VS Code style): one input
 * plus match options on top, a file-grouped result list below. Clicking a hit
 * opens the note and selects the matched range in the editor.
 */
export default function GlobalSearchPanel({ onClose }: GlobalSearchPanelProps): JSX.Element {
  const { t } = useTranslation()
  const root = useWorkspaceRoot()
  const { query, setQuery, options, toggleOption, result, searching, error, openMatch, clear } =
    useGlobalSearch()
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the field as soon as the panel opens — searching is the only thing
  // the user wants to do here.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Enter jumps to the first hit; Escape dismisses the panel.
  const firstMatch = useMemo<{ file: SearchFileResult; match: SearchMatch } | null>(() => {
    const file = result?.files[0]
    if (!file || file.matches.length === 0) return null
    return { file, match: file.matches[0] }
  }, [result])

  // Escape is handled by the section-level handler (keydown bubbles up from
  // here), so only Enter needs special-casing in the field.
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && firstMatch) {
      e.preventDefault()
      openMatch(firstMatch.file, firstMatch.match)
    }
  }

  const toggleFile = (path: string): void => {
    setCollapsedPaths((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  const showEmptyState = !query.trim() && !result

  return (
    <section
      className="flex max-h-[45vh] min-h-0 shrink-0 flex-col border-b border-border bg-bg-surface"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex min-w-0 flex-1 items-center">
          <span className="pointer-events-none absolute left-2 text-text-muted">
            <SearchIcon width={14} height={14} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
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
                file.matches.map((match, index) => (
                  <button
                    key={`${match.line}:${match.column}:${index}`}
                    onClick={() => openMatch(file, match)}
                    title={t('globalSearch.openMatch')}
                    className="flex w-full items-baseline gap-2 px-3 py-[3px] pl-8 text-left text-xs hover:bg-bg-subtle"
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
                              className="rounded-sm bg-accent-soft px-0.5 font-semibold text-text"
                            >
                              {segment.text}
                            </mark>
                          ) : (
                            <span key={i}>{segment.text}</span>
                          )
                      )}
                    </span>
                  </button>
                ))}
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

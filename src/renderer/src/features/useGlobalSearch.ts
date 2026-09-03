import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchFileResult, SearchMatch, SearchResult } from '@shared/types'
import { cancelSearch, searchWorkspace } from '../services/search'
import { readFileSync } from '../services/fileOps'
import { baseNameAny } from '../services/pathUtils'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspaceRoot } from '../hooks/useWorkspaceRoot'

/** Debounce between keystrokes before a scan starts. */
const DEBOUNCE_MS = 250

/** Toggles mirrored from the search panel. */
export interface GlobalSearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
}

/** Why the panel shows an error instead of results. */
export type SearchErrorKind = 'invalidRegex' | 'noWorkspace' | 'failed'

/**
 * Owns the global-search lifecycle: debounced scanning, superseding previous
 * runs, and opening a hit (read file → open tab → reveal the range).
 *
 * Search ids are the currency of staleness: every run carries one, a newer run
 * cancels the older id in main, and late responses whose id is no longer the
 * newest are discarded instead of overwriting fresh results.
 */
export function useGlobalSearch(): {
  query: string
  setQuery: (value: string) => void
  options: GlobalSearchOptions
  toggleOption: (key: keyof GlobalSearchOptions) => void
  result: SearchResult | null
  searching: boolean
  error: SearchErrorKind | null
  openMatch: (file: SearchFileResult, match: SearchMatch) => void
  clear: () => void
  refresh: () => void
} {
  const root = useWorkspaceRoot()
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<SearchErrorKind | null>(null)
  // Bumped to force a re-run without changing the query (e.g. after a replace).
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Newest issued search id — responses that don't match are stale.
  const latestIdRef = useRef('')
  const idCounterRef = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()

    if (!root) {
      setResult(null)
      setSearching(false)
      setError(trimmed === '' ? null : 'noWorkspace')
      return
    }
    if (trimmed === '') {
      setResult(null)
      setSearching(false)
      setError(null)
      return
    }
    // Validate the pattern locally: instant feedback, and main never sees a
    // pattern that would throw there.
    if (useRegex) {
      try {
        new RegExp(trimmed, 'u')
      } catch {
        setResult(null)
        setSearching(false)
        setError('invalidRegex')
        return
      }
    }

    setError(null)
    setSearching(true)
    idCounterRef.current += 1
    const searchId = `s${idCounterRef.current}`
    latestIdRef.current = searchId

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await searchWorkspace({
            query: trimmed,
            caseSensitive,
            wholeWord,
            useRegex,
            searchId
          })
          if (latestIdRef.current !== searchId) return // superseded
          if (next.cancelled) return
          setResult(next)
          setSearching(false)
        } catch {
          if (latestIdRef.current !== searchId) return
          setResult(null)
          setSearching(false)
          setError('failed')
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      // Superseded before it could start (or already in flight in main).
      if (latestIdRef.current === searchId) {
        latestIdRef.current = ''
      }
      void cancelSearch(searchId)
    }
  }, [query, caseSensitive, wholeWord, useRegex, root, refreshNonce])

  const toggleOption = useCallback((key: keyof GlobalSearchOptions) => {
    if (key === 'caseSensitive') setCaseSensitive((v) => !v)
    else if (key === 'wholeWord') setWholeWord((v) => !v)
    else setUseRegex((v) => !v)
  }, [])

  /** Open the file (if needed) and select the matched range in the editor. */
  const openMatch = useCallback((file: SearchFileResult, match: SearchMatch): void => {
    const state = useWorkspaceStore.getState()
    if (state.tabs.some((t) => t.path === file.path)) {
      state.setActive(file.path)
      useWorkspaceStore.getState().requestReveal({
        path: file.path,
        line: match.line,
        column: match.column,
        length: match.length
      })
      return
    }
    void (async () => {
      try {
        const content = await readFileSync(file.path)
        useWorkspaceStore.getState().openFile(file.path, baseNameAny(file.path), content)
      } catch {
        return // file vanished between search and click
      }
      useWorkspaceStore.getState().requestReveal({
        path: file.path,
        line: match.line,
        column: match.column,
        length: match.length
      })
    })()
  }, [])

  const clear = useCallback(() => {
    setQuery('')
    setResult(null)
    setError(null)
  }, [])

  /** Re-run the current search (used after a replace changes files on disk). */
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), [])

  return {
    query,
    setQuery,
    options: { caseSensitive, wholeWord, useRegex },
    toggleOption,
    result,
    searching,
    error,
    openMatch,
    clear,
    refresh
  }
}

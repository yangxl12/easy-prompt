/**
 * Workspace search client (pure wrappers around `window.api`) plus the
 * display helpers used by the search panel. No store access in here — the
 * feature hook owns state and passes everything in.
 */

import type { SearchOptions, SearchResult } from '@shared/types'

/** Run a workspace search. `searchId` echoes back so stale runs can be dropped. */
export function searchWorkspace(
  options: SearchOptions & { searchId: string }
): Promise<SearchResult> {
  return window.api.searchWorkspace(options)
}

/** Tell main to abandon an in-flight search (safe to call for unknown ids). */
export function cancelSearch(searchId: string): Promise<void> {
  return window.api.cancelSearch(searchId)
}

/** A slice of a result line: either plain text or a highlighted match. */
export interface LineSegment {
  text: string
  /** True when this segment is the matched text. */
  hit: boolean
}

/**
 * Split a result line into plain/highlighted segments for rendering.
 *
 * `column`/`length` come from main and index the *original* line, while
 * `lineText` may be truncated — when the match lies past the cut we simply
 * render the line unhighlighted rather than mis-highlighting the wrong span.
 */
export function splitMatchSegments(
  lineText: string,
  column: number,
  length: number
): LineSegment[] {
  if (column < 0 || length <= 0 || column >= lineText.length) {
    return lineText ? [{ text: lineText, hit: false }] : []
  }
  const end = Math.min(column + length, lineText.length)
  const segments: LineSegment[] = []
  if (column > 0) segments.push({ text: lineText.slice(0, column), hit: false })
  segments.push({ text: lineText.slice(column, end), hit: true })
  if (end < lineText.length) segments.push({ text: lineText.slice(end), hit: false })
  return segments
}

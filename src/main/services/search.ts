import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SearchFileResult, SearchMatch, SearchOptions, SearchResult } from '@shared/types'

/**
 * Workspace-wide content search over Markdown files.
 *
 * The scan is deliberately dumb and fast: collect every `.md` file, read them
 * in small batches, and run one RegExp per line. There is no index — a prompt
 * workspace is small enough that a full scan on every keystroke (debounced)
 * stays well under the perceived-instant threshold.
 *
 * Cancellation is cooperative: the renderer passes a `searchId` and can call
 * `cancelSearch(id)` when a newer query supersedes the run. The scan checks
 * the token between batches, so a stale run bails out early instead of
 * reporting results nobody is waiting for.
 */

const MD_EXT = '.md'
/** Files larger than this are skipped — they are not hand-written notes. */
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** Very long lines are truncated in the preview (the jump column stays real). */
const MAX_LINE_CHARS = 400
const MAX_MATCHES_PER_FILE = 100
const MAX_TOTAL_MATCHES = 1000
const MAX_SCANNED_FILES = 5000
const READ_CONCURRENCY = 16

/** Ids of searches the renderer is no longer interested in. */
const cancelledIds = new Set<string>()

/** Mark an in-flight search as obsolete. Cheap and safe for unknown ids. */
export function cancelSearch(searchId: string): void {
  cancelledIds.add(searchId)
}

/** Escape a literal query so it can be embedded in a RegExp source. */
function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build the scanner RegExp. `wholeWord` uses lookarounds over Unicode letters
 * instead of `\b`, because `\b` treats CJK as non-word and would happily match
 * "中国" inside "中国人民".
 */
function buildMatcher(options: SearchOptions): RegExp {
  const source = options.useRegex ? options.query : escapeRegExp(options.query)
  const word = '[\\p{L}\\p{N}_]'
  const body = options.wholeWord
    ? `(?<!${word})(?:${source})(?!${word})`
    : source
  const flags = options.caseSensitive ? 'gu' : 'giu'
  return new RegExp(body, flags)
}

/** Truncate a line for display without touching the real match column. */
function previewLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line
  return `${line.slice(0, MAX_LINE_CHARS)}…`
}

/** Collect every `.md` file under `root`, skipping dotfiles like the tree does. */
async function collectMdFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable folder — skip it
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(abs)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(MD_EXT)) {
        found.push(abs)
      }
    }
    if (found.length >= MAX_SCANNED_FILES) break
  }
  return found.slice(0, MAX_SCANNED_FILES)
}

/** All matches of `re` in `text`, one entry per hit. */
function scanText(text: string, re: RegExp): SearchMatch[] {
  const matches: SearchMatch[] = []
  const lines = text.split(/\r\n|\n|\r/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length === 0) continue
    re.lastIndex = 0
    let hit: RegExpExecArray | null
    while ((hit = re.exec(line)) !== null) {
      // Zero-length matches (e.g. `a*`) never advance lastIndex — step manually
      // instead of spinning forever on the same position.
      if (hit[0].length === 0) {
        re.lastIndex += 1
        if (re.lastIndex > line.length) break
        continue
      }
      matches.push({
        line: i + 1,
        column: hit.index,
        length: hit[0].length,
        lineText: previewLine(line)
      })
      if (matches.length >= MAX_MATCHES_PER_FILE) return matches
    }
  }
  return matches
}

/**
 * Search every Markdown file in the workspace. Never throws for a bad pattern
 * on a single file — unreadable files are skipped so one failure can't kill the
 * whole run.
 */
export async function searchWorkspace(
  root: string,
  options: SearchOptions,
  searchId: string
): Promise<SearchResult> {
  const blank: SearchResult = {
    searchId,
    files: [],
    totalMatches: 0,
    scannedFiles: 0,
    truncated: false,
    cancelled: false
  }
  const query = options.query ?? ''
  if (query === '') return blank

  let re: RegExp
  try {
    re = buildMatcher({ ...options, query })
  } catch {
    // The renderer validates the pattern first; this is the backstop.
    throw new Error('Invalid search pattern')
  }

  const allFiles = await collectMdFiles(root)
  const files: SearchFileResult[] = []
  let totalMatches = 0
  let scannedFiles = 0
  let truncated = allFiles.length >= MAX_SCANNED_FILES
  let cancelled = false

  for (let i = 0; i < allFiles.length; i += READ_CONCURRENCY) {
    if (cancelledIds.has(searchId)) {
      cancelled = true
      break
    }
    const batch = allFiles.slice(i, i + READ_CONCURRENCY)
    const contents = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const stat = await fs.stat(filePath)
          if (stat.size > MAX_FILE_BYTES) return null
          return await fs.readFile(filePath, 'utf-8')
        } catch {
          return null // deleted mid-scan, permission denied, …
        }
      })
    )
    for (let j = 0; j < batch.length; j++) {
      const text = contents[j]
      scannedFiles++
      if (text === null) continue
      const matches = scanText(text, re)
      if (matches.length === 0) continue
      files.push({ path: batch[j], name: path.basename(batch[j]), matches })
      totalMatches += matches.length
      if (totalMatches >= MAX_TOTAL_MATCHES) {
        truncated = true
        break
      }
    }
    if (truncated) break
    // Yield between batches so a burst of searches can't starve the main loop.
    await new Promise((resolve) => setImmediate(resolve))
  }

  cancelledIds.delete(searchId)

  files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  return { searchId, files, totalMatches, scannedFiles, truncated, cancelled }
}

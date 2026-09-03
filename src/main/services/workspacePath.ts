import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Workspace path policy — the single gate every renderer-supplied path must
 * pass through before the main process touches the file system. It enforces:
 *  - a configured, non-empty workspace;
 *  - lexical containment (path.resolve + path.relative, Windows-safe);
 *  - real containment (symlinks/junctions cannot escape the workspace);
 *  - `.md`-only file access where requested.
 *
 * IPC handlers must never trust renderer paths directly: TypeScript only
 * constrains the calling side, not what actually arrives over the bridge.
 */

/** Typed error for policy violations (message is safe to send over IPC). */
export class WorkspacePathError extends Error {}

function fail(message: string): never {
  throw new WorkspacePathError(message)
}

/**
 * True when `child` is `parent` itself or lives inside it. Uses
 * path.relative (case-insensitive on Windows) instead of string prefixes so
 * adjacent-prefix directories like `C:\ws` vs `C:\ws-other` are not confused.
 */
export function isPathWithin(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

/**
 * Resolve the deepest existing ancestor of `p` through symlinks/junctions.
 * Needed because write targets may not exist yet — the existing part of the
 * path is what can smuggle us outside the workspace.
 */
async function realpathDeep(p: string): Promise<string> {
  let cur = path.resolve(p)
  for (;;) {
    try {
      return await fs.realpath(cur)
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return cur
      cur = parent
    }
  }
}

/**
 * Resolve a renderer-supplied path against the workspace root and guarantee
 * it stays inside it, including through symlinks/junctions. Relative paths
 * are interpreted inside the workspace.
 */
export async function resolveWorkspacePath(root: string, candidate: string): Promise<string> {
  if (typeof root !== 'string' || root.trim() === '') fail('No workspace selected')
  if (typeof candidate !== 'string' || candidate.length === 0) fail('Invalid path')
  if (candidate.includes('\0')) fail('Invalid path')
  const resolved = path.resolve(root, candidate)
  // Lexical boundary first (catches plain `..` traversal)…
  if (!isPathWithin(root, resolved)) fail('Path is outside the workspace')
  // …then re-check after following symlinks/junctions.
  const realRoot = await realpathDeep(root)
  const real = await realpathDeep(resolved)
  if (!isPathWithin(realRoot, real)) fail('Path is outside the workspace')
  return resolved
}

/** Like `resolveWorkspacePath`, but additionally requires a `.md` file path. */
export async function resolveWorkspaceMdFile(root: string, candidate: string): Promise<string> {
  const p = await resolveWorkspacePath(root, candidate)
  if (!p.toLowerCase().endsWith('.md')) fail('Only Markdown (.md) files are allowed')
  return p
}

/* ---------- Runtime argument validation (untrusted IPC input) ---------- */

/** Validate a required string argument (type + length). */
export function assertString(
  value: unknown,
  maxLen: number,
  what: string,
  allowEmpty = false
): string {
  if (typeof value !== 'string') fail(`Invalid ${what}`)
  if (!allowEmpty && value.length === 0) fail(`Invalid ${what}`)
  if (value.length > maxLen) fail(`${what} is too long`)
  return value
}

/** Validate a non-empty array of string arguments. */
export function assertStringArray(
  value: unknown,
  maxItems: number,
  maxLen: number,
  what: string
): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(`Invalid ${what}`)
  if (value.length > maxItems) fail(`Too many ${what}`)
  return value.map((v) => assertString(v, maxLen, what))
}

// Characters Windows forbids in file names (plus separators and control chars).
const INVALID_NAME_RE = /[\\/:*?"<>|\u0000-\u001f]/

/**
 * Validate a user-supplied node name (file/folder create & rename). Rejects
 * separators (no path smuggling), dotfiles, traversal names and Windows
 * reserved characters.
 */
export function assertNodeName(name: unknown): string {
  const n = assertString(name, 200, 'name')
  const trimmed = n.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') fail('Invalid name')
  if (n.startsWith('.')) fail('Invalid name')
  if (INVALID_NAME_RE.test(n)) fail('Invalid name')
  return n
}

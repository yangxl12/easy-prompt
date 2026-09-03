/**
 * Cross-separator path helpers for the renderer. Renderer code must never
 * split/join OS paths by hand (Windows uses `\`), but a few UI-side decisions
 * (tab subtree matching, display names) still need minimal comparisons —
 * those live here.
 */

/** Normalize both separators to `/` and strip trailing separators. */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * True when `child` equals `parent` or lives inside it. Unlike a bare
 * `startsWith`, `C:\ws\foo` does not match `C:\ws\foobar.md`.
 */
export function isPathWithin(parent: string, child: string): boolean {
  if (!parent || !child) return false
  if (child === parent) return true
  const p = normalize(parent)
  const c = normalize(child)
  return c === p || c.startsWith(p + '/')
}

/** Last path segment, tolerating both `/` and `\` separators. */
export function baseNameAny(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/**
 * Directory of `filePath` expressed relative to `root` — display only (used by
 * the search panel to disambiguate same-named notes). Returns '' when the file
 * sits directly in the workspace root, and the absolute directory when it is
 * not under `root` at all.
 */
export function relativeDirFrom(root: string | null, filePath: string): string {
  const dir = filePath.slice(0, filePath.length - baseNameAny(filePath).length)
  if (!root) return normalize(dir)
  const r = normalize(root)
  const d = normalize(dir)
  // Case-insensitive: Windows paths from main may differ in drive-letter case.
  if (d === r) return ''
  if (d.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return d.slice(r.length + 1)
  return d
}

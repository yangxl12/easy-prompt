/**
 * Best-effort localStorage adapter for renderer-only UI preferences (tree
 * order, file markers). All failures are swallowed — local UI metadata must
 * never block file operations.
 */

export const TREE_ORDER_STORAGE_KEY = 'easyprompt.tree-order'
export const FILE_MARKER_STORAGE_KEY = 'easyprompt.file-markers'

export function readLocalPref<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeLocalPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Local UI metadata is best-effort and must never block file operations.
  }
}

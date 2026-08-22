/**
 * Draft-tab semantics. Draft tabs (`draft://…`) are transient in-memory tabs
 * with no backing file — they must never be passed to file-system APIs.
 */

/** Path prefix for transient in-memory tabs created by dropping onto the empty state. */
export const DRAFT_PREFIX = 'draft://'

/** True when a tab path refers to a transient in-memory draft (not a real file). */
export function isDraftPath(path: string): boolean {
  return path.startsWith(DRAFT_PREFIX)
}

/** Build a unique draft tab path for a newly-spawned draft. */
export function newDraftPath(): string {
  return `${DRAFT_PREFIX}${Date.now()}`
}

/**
 * Renderer-side id generator. `crypto.randomUUID` is available in the renderer
 * (secure context, modern Electron), but we guard with a fallback for safety.
 */
export function randomLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

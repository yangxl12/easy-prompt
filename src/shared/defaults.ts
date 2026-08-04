import type { AppConfig } from './types'

/**
 * A renderer-safe placeholder config (no Node APIs, no `process` access).
 *
 * `createDefaultConfig()` (in `src/shared/defaults.node.ts`) needs `node:path`
 * and `node:os` to compute a real workspace path, which the renderer cannot
 * import. The renderer only needs an initial object before the real config
 * arrives over IPC, so it uses this stub instead.
 *
 * `shortcut` is left empty here — the real default is resolved by the main
 * process via `defaultShortcut(process.platform)`.
 */
export function createDefaultConfigRenderer(): AppConfig {
  return {
    schemaVersion: 1,
    app: {
      theme: 'system',
      language: 'zh-CN',
      workspace: '',
      shortcut: '',
      autoSave: true,
      optimizeDefaultAction: 'overwrite',
      showPreview: false,
      sidebarCollapsed: false,
      showOptimizeWholeFile: false
    },
    ai: {
      models: [],
      currentModelId: ''
    }
  }
}

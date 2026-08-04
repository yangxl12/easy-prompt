import type { AppConfig } from './types'
import { defaultShortcut } from './types'

/**
 * Build the default config for a fresh install.
 * `workspace` starts empty — the user picks their own folder on first use.
 *
 * MAIN PROCESS ONLY — imports node:path and node:os. The renderer uses
 * `createDefaultConfigRenderer()` from `./defaults` instead.
 */
export function createDefaultConfig(): AppConfig {
  return {
    schemaVersion: 1,
    app: {
      theme: 'system',
      language: 'zh-CN',
      workspace: '',
      shortcut: defaultShortcut(process.platform),
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

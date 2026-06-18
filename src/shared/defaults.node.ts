import path from 'node:path'
import os from 'node:os'
import type { AppConfig } from './types'
import { defaultShortcut } from './types'

/**
 * Build the default config for a fresh install.
 * `workspace` defaults to a per-user folder under Documents.
 *
 * MAIN PROCESS ONLY — imports node:path and node:os. The renderer uses
 * `createDefaultConfigRenderer()` from `./defaults` instead.
 */
export function createDefaultConfig(): AppConfig {
  const documents = path.join(os.homedir(), 'Documents', 'EasyPrompt')
  return {
    schemaVersion: 1,
    app: {
      theme: 'system',
      language: 'zh-CN',
      workspace: documents,
      shortcut: defaultShortcut(process.platform),
      autoSave: true,
      optimizeDefaultAction: 'overwrite',
      showPreview: false,
      sidebarCollapsed: false
    },
    ai: {
      models: [],
      currentModelId: ''
    }
  }
}

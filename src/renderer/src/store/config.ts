import { create } from 'zustand'
import type { AppConfig, AppConfigPatch, ThemeMode, Language } from '@shared/types'
import { createDefaultConfigRenderer } from '@shared/defaults'
import { resolveCurrentModel } from '../services/ai'

/**
 * Central config store. Hydrated once from main at boot, and kept in sync
 * when main broadcasts `config:changed`. Theme & language are applied as
 * side effects (DOM class + i18n) by components subscribing to the store.
 */
interface ConfigState {
  config: AppConfig
  /** True until the first getConfig() resolves. */
  loaded: boolean

  setConfig: (next: AppConfig) => void
  patchConfig: (patch: AppConfigPatch) => Promise<void>
  setTheme: (theme: ThemeMode) => Promise<void>
  setLanguage: (lang: Language) => Promise<void>

  /** Convenience: the currently active AI model, or null if none configured. */
  currentModel: () => AppConfig['ai']['models'][number] | null
  /** True when AI features should be disabled (no usable model). */
  aiReady: () => boolean
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: createDefaultConfigRenderer(),
  loaded: false,

  setConfig: (next) => set({ config: next, loaded: true }),

  patchConfig: async (patch) => {
    const next = await window.api.patchConfig(patch)
    set({ config: next, loaded: true })
  },

  setTheme: async (theme) => {
    await get().patchConfig({ app: { theme } })
  },

  setLanguage: async (language) => {
    await get().patchConfig({ app: { language } })
  },

  currentModel: () => resolveCurrentModel(get().config),

  aiReady: () => {
    const m = get().currentModel()
    // A masked key ("••••") means a real key is stored; empty string means none.
    return Boolean(m && m.apiKey.length > 0)
  }
}))

/** Resolve a theme mode ('system') into a concrete light/dark value. */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

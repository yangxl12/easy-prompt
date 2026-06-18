import { app, safeStorage } from 'electron'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import type { AppConfig, AIModelConfig, AISettings, AppConfigPatch } from '@shared/types'
import { createDefaultConfig } from '@shared/defaults.node'

/**
 * Lightweight persisted config store — a single JSON file in the user data dir.
 *
 * We deliberately avoid the `electron-store` dependency: v9/v10 are ESM-only
 * and incompatible with our CJS main bundle. The needs here are trivial
 * (read/write JSON + encrypt secrets), so a hand-rolled store is simpler and
 * dependency-free.
 *
 * API keys are encrypted with Electron's safeStorage (OS keychain-backed)
 * before being written to disk, so the file never holds a plaintext key.
 */

const KEY_PREFIX = 'enc:'
let cached: AppConfig | null = null
let filePath = ''

function configPath(): string {
  if (!filePath) {
    filePath = path.join(app.getPath('userData'), 'config.json')
  }
  return filePath
}

/** Encrypt a secret string; falls back to plaintext if keychain unavailable. */
function encrypt(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return KEY_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value
  }
}

/** Decrypt a value produced by `encrypt`. */
function decrypt(value: string): string {
  if (!value) return ''
  if (!value.startsWith(KEY_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    const buf = Buffer.from(value.slice(KEY_PREFIX.length), 'base64')
    return safeStorage.decryptString(buf)
  } catch {
    return ''
  }
}

/** Mask API keys when handing config to the renderer. */
function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

/** Read & parse the config file, falling back to defaults. */
async function loadFromDisk(): Promise<AppConfig> {
  const file = configPath()
  try {
    if (!existsSync(file)) return createDefaultConfig()
    const raw = await fs.readFile(file, 'utf-8')
    return { ...createDefaultConfig(), ...(JSON.parse(raw) as AppConfig) }
  } catch (err) {
    console.error('[EasyPrompt] Failed to read config, using defaults:', err)
    return createDefaultConfig()
  }
}

/** Serialize & write the config atomically. */
async function saveToDisk(value: AppConfig): Promise<void> {
  const file = configPath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
  await fs.rename(tmp, file)
}

/** Ensure the in-memory cache is populated. */
async function ensureLoaded(): Promise<AppConfig> {
  if (!cached) cached = await loadFromDisk()
  return cached
}

/** Read whole config, decrypting & masking keys for the renderer. */
export async function getConfigForRenderer(): Promise<AppConfig> {
  const raw = await ensureLoaded()
  return {
    ...raw,
    ai: {
      ...raw.ai,
      models: raw.ai.models.map((m) => ({
        ...m,
        apiKey: maskApiKey(decrypt(m.apiKey))
      }))
    }
  }
}

/** Read whole config with real (decrypted) keys — main process only. */
export async function getConfigInternal(): Promise<AppConfig> {
  const raw = await ensureLoaded()
  return {
    ...raw,
    ai: {
      ...raw.ai,
      models: raw.ai.models.map((m) => ({ ...m, apiKey: decrypt(m.apiKey) }))
    }
  }
}

/** Convenience: just the AI settings with decrypted keys. */
export async function getAISettingsInternal(): Promise<AISettings> {
  return (await getConfigInternal()).ai
}

/** Replace the entire config. Keys are encrypted before persistence. */
export async function setConfig(next: AppConfig): Promise<AppConfig> {
  const toStore: AppConfig = {
    ...next,
    ai: {
      ...next.ai,
      models: next.ai.models.map((m) => persistModel(m, cached))
    }
  }
  cached = toStore
  await saveToDisk(toStore)
  return getConfigForRenderer()
}

/**
 * Merge a partial patch into stored config. Model list is replaced wholesale
 * when provided (caller controls ordering).
 */
export async function patchConfig(patch: AppConfigPatch): Promise<AppConfig> {
  const current = await ensureLoaded()
  const merged: AppConfig = {
    schemaVersion: current.schemaVersion,
    app: { ...current.app, ...(patch.app ?? {}) },
    ai: patch.ai
      ? {
          models: patch.ai.models.map((m) => persistModel(m, current)),
          currentModelId: patch.ai.currentModelId
        }
      : current.ai
  }
  cached = merged
  await saveToDisk(merged)
  return getConfigForRenderer()
}

/**
 * When a model arrives with a masked key ("••••"), the real key wasn't changed
 * — preserve the previously-stored encrypted value.
 */
function persistModel(m: AIModelConfig, current: AppConfig | null): AIModelConfig {
  if (m.apiKey && m.apiKey.includes('••••')) {
    const existing = current?.ai.models.find((x) => x.id === m.id)?.apiKey
    return { ...m, apiKey: existing ?? encrypt('') }
  }
  return { ...m, apiKey: encrypt(m.apiKey) }
}

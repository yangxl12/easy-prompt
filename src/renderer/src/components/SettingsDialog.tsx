import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AIModelConfig, AppConfig, ThemeMode, Language, OptimizeDefaultAction } from '@shared/types'
import { MODEL_PRESETS, newModelId } from '@shared/presets'
import { LANGUAGES } from '@shared/i18n'
import { useConfigStore } from '../store/config'
import { Button } from './ui/Button'
import { CloseIcon, PlusIcon, CheckIcon, TrashIcon, SparkleIcon } from './ui/icons'

interface SettingsDialogProps {
  onClose: () => void
}

type Tab = 'general' | 'ai'

export default function SettingsDialog({ onClose }: SettingsDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('general')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-[80%] w-[680px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t('settings.title')}</h2>
          <button onClick={onClose} className="rounded p-1 text-text-muted hover:bg-bg-subtle">
            <CloseIcon />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Tabs */}
          <nav className="w-40 shrink-0 border-r border-border p-2">
            {(['general', 'ai'] as Tab[]).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`mb-0.5 w-full rounded-md px-3 py-2 text-left text-sm ${
                  tab === key
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-muted hover:bg-bg-subtle hover:text-text'
                }`}
              >
                {key === 'general' ? t('settings.general') : t('settings.aiModels')}
              </button>
            ))}
          </nav>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {tab === 'general' ? <GeneralTab /> : <AITab />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ General ------------------------------ */
function GeneralTab(): JSX.Element {
  const { t } = useTranslation()
  const { config, setTheme, setLanguage, patchConfig } = useConfigStore()
  const [migrating, setMigrating] = useState(false)
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null)
  const [migrateError, setMigrateError] = useState(false)

  const handleChangeWorkspace = async (): Promise<void> => {
    const chosen = await window.api.selectWorkspace()
    if (!chosen || chosen === config.app.workspace) return

    const ok = window.confirm(t('settings.migrateConfirm'))
    if (!ok) return

    setMigrating(true)
    setMigrateMsg(t('settings.migrating'))
    setMigrateError(false)

    try {
      const result = await window.api.changeWorkspace(chosen)
      if (result.success) {
        setMigrateMsg(t('settings.migrateDone'))
        // Refresh config so the displayed path updates.
        const next = await window.api.getConfig()
        useConfigStore.getState().setConfig(next)
      } else {
        setMigrateMsg(t('settings.migrateFailed', { message: result.error || '' }))
        setMigrateError(true)
      }
    } catch (err) {
      setMigrateMsg(t('settings.migrateFailed', { message: (err as Error).message }))
      setMigrateError(true)
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div className="space-y-6 text-sm">
      <Field label={t('settings.theme')}>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={config.app.theme === mode ? 'primary' : 'secondary'}
              onClick={() => void setTheme(mode)}
            >
              {t(`settings.${mode}`)}
            </Button>
          ))}
        </div>
      </Field>

      <Field label={t('settings.language')}>
        <select
          className="h-9 rounded-md border border-border bg-bg-base px-2 text-sm outline-none"
          value={config.app.language}
          onChange={(e) => void setLanguage(e.target.value as Language)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('settings.workspace')} hint={t('settings.workspaceHint')}>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md bg-bg-subtle px-3 py-2 text-xs text-text-muted">
            {config.app.workspace}
          </code>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleChangeWorkspace}
            disabled={migrating}
          >
            {t('settings.changeWorkspace')}
          </Button>
        </div>
        {migrateMsg && (
          <div
            className={`mt-2 rounded-md px-3 py-2 text-xs ${
              migrateError
                ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
            }`}
          >
            {migrateMsg}
          </div>
        )}
      </Field>

      <Field label={t('settings.shortcut')}>
        <ShortcutRecorder
          value={config.app.shortcut}
          onChange={(accel) => void patchConfig({ app: { shortcut: accel } })}
        />
      </Field>

      <Field label={t('settings.autoSave')} hint={t('settings.autoSaveHint')}>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={config.app.autoSave}
            onChange={(e) => void patchConfig({ app: { autoSave: e.target.checked } })}
            className="peer sr-only"
          />
          <div className="h-5 w-9 rounded-full bg-border transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30">
            <div className="m-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
          </div>
        </label>
      </Field>

      <Field label={t('settings.optimizeDefaultAction')} hint={t('settings.optimizeDefaultActionHint')}>
        <select
          className="h-9 rounded-md border border-border bg-bg-base px-2 text-sm outline-none"
          value={config.app.optimizeDefaultAction}
          onChange={(e) =>
            void patchConfig({ app: { optimizeDefaultAction: e.target.value as OptimizeDefaultAction } })
          }
        >
          <option value="overwrite">{t('settings.optimizeOverwrite')}</option>
          <option value="keep">{t('settings.optimizeKeep')}</option>
          <option value="ask">{t('settings.optimizeAsk')}</option>
        </select>
      </Field>

      <Field label={t('settings.showPreview')} hint={t('settings.showPreviewHint')}>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={config.app.showPreview}
            onChange={(e) => void patchConfig({ app: { showPreview: e.target.checked } })}
            className="peer sr-only"
          />
          <div className="h-5 w-9 rounded-full bg-border transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30">
            <div className="m-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
          </div>
        </label>
      </Field>
    </div>
  )
}

/**
 * Visual keyboard shortcut recorder. Shows the current shortcut as styled
 * key caps. Clicking "Change" enters listening mode — a panel appears and
 * listens for the next key combo at the *document* level (not on the button,
 * so Space and other special keys work). Escape cancels, a valid combo
 * commits immediately.
 *
 * Electron accelerator key mapping (non-exhaustive):
 *   Space → Space   Arrow keys → Up/Down/Left/Right
 *   A-Z / 0-9 → uppercase   F1-F12 → F1..F12
 *   Modifiers: Ctrl / Alt / Shift / Cmd(or Super on Win/Linux)
 */
function ShortcutRecorder({
  value,
  onChange
}: {
  value: string
  onChange: (accel: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [listening, setListening] = useState(false)
  const [preview, setPreview] = useState<string>('')
  const [justSaved, setJustSaved] = useState(false)
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)

  // Document-level keydown listener — critical for Space to work, because
  // Space on a focused <button> fires a click, not a keydown.
  useEffect(() => {
    if (!listening) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      // Escape cancels.
      if (e.key === 'Escape') {
        setListening(false)
        setPreview('')
        return
      }

      // Build modifier list.
      const mods: string[] = []
      if (e.ctrlKey) mods.push('Ctrl')
      if (e.altKey) mods.push('Alt')
      if (e.metaKey) mods.push(isMac ? 'Cmd' : 'Super')
      if (e.shiftKey) mods.push('Shift')

      // Ignore lone modifier presses — show a live preview of what's held.
      if (['Control', 'Alt', 'Meta', 'Shift'].includes(e.key)) {
        setPreview(mods.join('+') || '…')
        return
      }

      // Map the key to Electron's accelerator name.
      let keyName: string
      switch (e.key) {
        case ' ':
          keyName = 'Space'
          break
        case 'ArrowUp':
          keyName = 'Up'
          break
        case 'ArrowDown':
          keyName = 'Down'
          break
        case 'ArrowLeft':
          keyName = 'Left'
          break
        case 'ArrowRight':
          keyName = 'Right'
          break
        case 'Tab':
          keyName = 'Tab'
          break
        case 'Escape':
          keyName = 'Esc'
          break
        case 'Backspace':
          keyName = 'Backspace'
          break
        case 'Delete':
          keyName = 'Delete'
          break
        case 'Enter':
          keyName = 'Enter'
          break
        case 'Home':
        case 'End':
        case 'PageUp':
        case 'PageDown':
        case 'Insert':
          keyName = e.key
          break
        default:
          // Single character keys: A-Z, 0-9, F1-F12, symbols, etc.
          if (e.key.length === 1) {
            keyName = e.key.toUpperCase()
          } else {
            // F1-F12, other named keys.
            keyName = e.key
          }
      }

      const accel = [...mods, keyName].join('+')

      // Commit.
      onChange(accel)
      setListening(false)
      setPreview('')
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 1000)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [listening, onChange, isMac])

  // Split the value into individual keys for kbd rendering.
  const keys = value ? value.split('+') : []

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Key-cap display */}
      <div className="flex items-center gap-1">
        {keys.length > 0 ? (
          keys.map((k, i) => (
            <span key={i} className="flex items-center gap-1">
              <kbd className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border border-border bg-bg-subtle px-2 text-xs font-medium text-text shadow-sm">
                {k}
              </kbd>
              {i < keys.length - 1 && (
                <span className="text-[10px] text-text-muted">+</span>
              )}
            </span>
          ))
        ) : (
          <span className="text-xs text-text-muted">{t('settings.shortcutNone')}</span>
        )}
      </div>

      {/* Change button */}
      {listening ? (
        <button
          onClick={() => {
            setListening(false)
            setPreview('')
          }}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white/80" />
          {preview ? (
            <span>{t('settings.listeningWith', { keys: preview })}</span>
          ) : (
            <span>{t('settings.listening')}</span>
          )}
        </button>
      ) : (
        <button
          onClick={() => setListening(true)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            justSaved
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-accent-soft text-accent hover:bg-accent/15'
          }`}
        >
          {justSaved ? '✓' : t('settings.change')}
        </button>
      )}

      {/* Reset to default */}
      {value !== 'Shift+Space' && (
        <button
          onClick={() => {
            onChange('Shift+Space')
            setJustSaved(true)
            setTimeout(() => setJustSaved(false), 1000)
          }}
          className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-bg-subtle hover:text-text transition-colors"
        >
          {t('settings.resetShortcut')}
        </button>
      )}
    </div>
  )
}

/* -------------------------------- AI -------------------------------- */
function AITab(): JSX.Element {
  const { t } = useTranslation()
  const { config, patchConfig } = useConfigStore()
  const ai = config.ai

  const update = (next: AppConfig['ai']): void => {
    void patchConfig({ ai: next })
  }

  const addModel = (): void => {
    const model: AIModelConfig = {
      id: newModelId(),
      name: 'New model',
      provider: 'openai-compatible',
      baseURL: '',
      apiKey: '',
      textModel: '',
      visionModel: ''
    }
    update({ models: [...ai.models, model], currentModelId: ai.currentModelId || model.id })
  }

  const importPreset = (preset: (typeof MODEL_PRESETS)[number]): void => {
    const model: AIModelConfig = {
      id: newModelId(),
      ...preset,
      apiKey: ''
    }
    update({ models: [...ai.models, model], currentModelId: ai.currentModelId || model.id })
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Preset imports */}
      <div>
        <div className="mb-2 text-xs font-medium text-text-muted">{t('settings.importPreset')}</div>
        <div className="flex flex-wrap gap-2">
          {MODEL_PRESETS.map((preset) => (
            <Button key={preset.name} size="sm" variant="secondary" onClick={() => importPreset(preset)}>
              <SparkleIcon />
              {preset.name}
            </Button>
          ))}
          <Button size="sm" variant="secondary" onClick={addModel}>
            <PlusIcon />
            {t('settings.addModel')}
          </Button>
        </div>
      </div>

      {ai.models.length === 0 ? (
        <p className="rounded-md bg-bg-subtle px-3 py-6 text-center text-xs text-text-muted">
          {t('settings.noModels')}
        </p>
      ) : (
        <div className="space-y-3">
          {ai.models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              isCurrent={model.id === ai.currentModelId}
              onChange={(updated) =>
                update({
                  models: ai.models.map((m) => (m.id === model.id ? updated : m)),
                  currentModelId: ai.currentModelId
                })
              }
              onRemove={() =>
                update({
                  models: ai.models.filter((m) => m.id !== model.id),
                  currentModelId:
                    ai.currentModelId === model.id
                      ? ai.models.find((m) => m.id !== model.id)?.id ?? ''
                      : ai.currentModelId
                })
              }
              onSetCurrent={() => update({ models: ai.models, currentModelId: model.id })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ModelCardProps {
  model: AIModelConfig
  isCurrent: boolean
  onChange: (updated: AIModelConfig) => void
  onRemove: () => void
  onSetCurrent: () => void
}

function ModelCard({
  model,
  isCurrent,
  onChange,
  onRemove,
  onSetCurrent
}: ModelCardProps): JSX.Element {
  const { t } = useTranslation()
  const [testing, setTesting] = useState(false)
  const [testResult, setResult] = useState<string | null>(null)

  const set = (patch: Partial<AIModelConfig>): void => onChange({ ...model, ...patch })

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      await window.api.testModel(model.id)
      setResult(t('settings.testOk'))
    } catch (err) {
      setResult((err as Error).message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-base p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isCurrent && (
            <span className="flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
              <CheckIcon width={10} height={10} />
              {t('settings.current')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isCurrent && (
            <Button size="sm" variant="ghost" onClick={onSetCurrent}>
              {t('settings.setCurrent')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onRemove} title={t('settings.remove')}>
            <TrashIcon />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DeferredInput
          label={t('settings.modelName')}
          value={model.name}
          onCommit={(v) => set({ name: v })}
        />
        <DeferredInput
          label={t('settings.baseUrl')}
          value={model.baseURL}
          onCommit={(v) => set({ baseURL: v })}
        />
        <DeferredInput
          label={t('settings.textModel')}
          value={model.textModel}
          onCommit={(v) => set({ textModel: v })}
        />
        <DeferredInput
          label={t('settings.visionModel')}
          value={model.visionModel}
          onCommit={(v) => set({ visionModel: v })}
        />
        <div className="col-span-2 -mt-1 text-[11px] leading-relaxed text-text-muted">
          {t('settings.visionModelHint')}
        </div>
        <div className="col-span-2">
          <DeferredInput
            label={t('settings.apiKey')}
            value={model.apiKey}
            onCommit={(v) => set({ apiKey: v })}
            type="password"
            placeholder="sk-..."
          />
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={runTest} disabled={testing || !model.apiKey}>
          {testing ? t('settings.testing') : t('settings.test')}
        </Button>
        {testResult && <span className="text-xs text-text-muted">{testResult}</span>}
      </div>
    </div>
  )
}

/**
 * A text field that edits a LOCAL draft and only pushes the value up on blur or
 * Enter. This avoids a round-trip to the main process (which persists config to
 * disk) on every keystroke — that round-trip is what made typing feel frozen.
 */
function DeferredInput({
  label,
  value,
  onCommit,
  type = 'text',
  placeholder
}: {
  label: string
  /** The committed (store) value. Used to seed the local draft. */
  value: string
  onCommit: (v: string) => void
  type?: string
  placeholder?: string
}): JSX.Element {
  const [draft, setDraft] = useState(value)

  // Re-seed the draft when the committed value changes externally (e.g. preset
  // import, model switch) — but only when we're not actively editing.
  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-text-muted">{label}</span>
      <input
        className="h-8 w-full rounded-md border border-border bg-bg-surface px-2 text-xs outline-none focus:border-accent"
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}

/* ------------------------------ helpers ------------------------------ */
function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-text-muted">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-text-muted">{hint}</div>}
    </div>
  )
}

import type { ReactNode } from 'react'
import { Button } from './Button'
import { CloseIcon } from './icons'

export interface ChoiceOption {
  label: string
  /** Distinguishes primary vs secondary styling. */
  variant?: 'primary' | 'secondary' | 'danger'
  value: string
}

interface ChoiceDialogProps {
  title: string
  /** Optional descriptive body. */
  description?: ReactNode
  options: ChoiceOption[]
  onChoose: (value: string) => void
  /** Called when the user dismisses (backdrop / × / Esc). Defaults to no-op. */
  onCancel?: () => void
  /** Show a cancel/× affordance. Defaults to true. */
  dismissible?: boolean
}

/**
 * A small modal presenting a set of choices. Used for AI workflow prompts like
 * "delete image / keep image" and "overwrite / save as new".
 */
export default function ChoiceDialog({
  title,
  description,
  options,
  onChoose,
  onCancel,
  dismissible = true
}: ChoiceDialogProps): JSX.Element {
  const close = (): void => {
    if (dismissible) onCancel?.()
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
    >
      <div
        className="w-[420px] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {dismissible && (
            <button onClick={close} className="rounded p-1 text-text-muted hover:bg-bg-subtle">
              <CloseIcon />
            </button>
          )}
        </div>
        {description && <div className="px-4 py-3 text-sm text-text-muted">{description}</div>}
        <div className="flex flex-col gap-2 p-4">
          {options.map((opt) => (
            <Button
              key={opt.value}
              variant={opt.variant ?? 'secondary'}
              onClick={() => onChoose(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

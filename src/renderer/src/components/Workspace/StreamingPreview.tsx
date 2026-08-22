import { useTranslation } from 'react-i18next'

/**
 * Live streaming preview bar shown while an AI operation is producing text
 * (whole-file optimize, selection optimize, selection polish).
 */
export default function StreamingPreview({ streaming }: { streaming: string | null }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="border-b border-border bg-accent-soft/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-text-muted">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        {t('ai.streaming')}
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-text">
        {streaming || '…'}
      </pre>
    </div>
  )
}

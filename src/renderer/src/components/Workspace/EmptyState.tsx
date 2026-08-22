import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Empty-workspace placeholder; accepts dropped images for the prompt flow. */
export default function EmptyState({
  onDropImage
}: {
  onDropImage?: (file: File) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  return (
    <div
      className={`flex min-h-0 flex-1 items-center justify-center text-text-muted ${
        dragOver ? 'bg-accent-soft/20 ring-2 ring-inset ring-accent' : ''
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const files = e.dataTransfer.files
        if (!files || files.length === 0) return
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith('image/')) {
            onDropImage?.(files[i])
            return
          }
        }
      }}
    >
      <div className="max-w-sm text-center">
        <div className="mb-3 text-3xl">✦</div>
        <h2 className="mb-1 text-base font-semibold text-text">{t('app.title')}</h2>
        <p className="text-sm">{t('tree.empty')}</p>
        <p className="mt-2 text-xs text-text-muted">{t('ai.pasteImageHint')}</p>
      </div>
    </div>
  )
}

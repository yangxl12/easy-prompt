import { useTranslation } from 'react-i18next'
import { useWorkspaceStore, type Tab } from '../../store/workspace'
import { CloseIcon, FileIcon } from '../ui/icons'

/**
 * Horizontal tab strip of open files. VS Code-style: click to activate, middle
 * click or × button to close. Dirty tabs show a dot instead of nothing.
 * When `onRequestClose` is provided, it's called instead of directly closing —
 * the parent can check for unsaved changes first.
 */
export default function TabBar({
  onRequestClose
}: {
  onRequestClose?: (path: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const setActive = useWorkspaceStore((s) => s.setActive)
  const closeTab = useWorkspaceStore((s) => s.closeTab)

  const handleClose = onRequestClose ?? closeTab

  if (tabs.length === 0) return <div className="h-9 shrink-0 border-b border-border bg-bg-surface" />

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-bg-surface">
      {tabs.map((tab) => (
        <TabButton
          key={tab.path}
          tab={tab}
          active={tab.path === activePath}
          title={t('tabs.close')}
          onActivate={() => setActive(tab.path)}
          onClose={() => handleClose(tab.path)}
        />
      ))}
    </div>
  )
}

function TabButton({
  tab,
  active,
  title,
  onActivate,
  onClose
}: {
  tab: Tab
  active: boolean
  title: string
  onActivate: () => void
  onClose: () => void
}): JSX.Element {
  const dirty = tab.dirtyContent !== null
  return (
    <div
      onClick={onActivate}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          onClose()
        }
      }}
      className={`group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 text-[13px] ${
        active ? 'bg-bg-base text-text' : 'text-text-muted hover:bg-bg-subtle'
      }`}
    >
      <FileIcon width={13} height={13} className="opacity-60" />
      <span className="max-w-[160px] truncate">{tab.name}</span>
      {dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      <button
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="rounded p-0.5 opacity-0 hover:bg-bg-subtle group-hover:opacity-100"
      >
        <CloseIcon width={13} height={13} />
      </button>
    </div>
  )
}

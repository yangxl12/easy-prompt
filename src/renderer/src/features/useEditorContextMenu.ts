import { useCallback, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store/config'
import { useWorkspaceStore } from '../store/workspace'
import { useContextMenu, type MenuItemDef } from '../components/ui/ContextMenu'
import type { EditorCommands } from '../components/EditorPane/CodeEditor'

/**
 * The editor's right-click context menu: clipboard basics, image picking, and
 * AI actions on the selection. Command targets are resolved from the commands
 * map at menu-open time.
 */
export function useEditorContextMenu(
  commandsMapRef: RefObject<Map<string, EditorCommands>>,
  actions: {
    optimizeSelection: () => Promise<void>
    pickImage: () => Promise<void>
  }
): (e: React.MouseEvent, hasSelection: boolean) => void {
  const { t } = useTranslation()
  const { open: openMenu } = useContextMenu()
  const aiReady = useConfigStore((s) => s.aiReady())
  const activePath = useWorkspaceStore((s) => s.activePath)
  const isReadOnly = useWorkspaceStore(
    (s) => s.tabs.find((tb) => tb.path === s.activePath)?.readOnly ?? false
  )

  return useCallback(
    (e: React.MouseEvent, hasSelection: boolean): void => {
      const cmds = activePath ? commandsMapRef.current?.get(activePath) : undefined
      const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
      const items: MenuItemDef[] = [
        {
          id: 'cut',
          label: t('editor.cut'),
          shortcut: `${mod}X`,
          disabled: !hasSelection || isReadOnly,
          onClick: () => cmds?.cut()
        },
        {
          id: 'copy',
          label: t('editor.copy'),
          shortcut: `${mod}C`,
          disabled: !hasSelection,
          onClick: () => cmds?.copy()
        },
        {
          id: 'paste',
          label: t('editor.paste'),
          shortcut: `${mod}V`,
          disabled: isReadOnly,
          onClick: () => cmds?.paste(),
          separatorAfter: true
        },
        {
          id: 'paste-image',
          label: t('editor.pasteImage'),
          disabled: isReadOnly,
          onClick: () => void actions.pickImage()
        },
        {
          id: 'optimize-selection',
          label: t('editor.optimizeSelection'),
          disabled: !hasSelection || !aiReady || isReadOnly,
          onClick: () => void actions.optimizeSelection(),
          separatorAfter: true
        },
        {
          id: 'select-all',
          label: t('editor.selectAll'),
          shortcut: `${mod}A`,
          onClick: () => cmds?.selectAll()
        },
        {
          id: 'undo',
          label: t('editor.undo'),
          shortcut: `${mod}Z`,
          disabled: isReadOnly,
          onClick: () => cmds?.undo()
        },
        {
          id: 'redo',
          label: t('editor.redo'),
          shortcut: `Shift+${mod}Z`,
          disabled: isReadOnly,
          onClick: () => cmds?.redo()
        }
      ]
      openMenu(e, items)
    },
    [aiReady, activePath, isReadOnly, openMenu, actions, commandsMapRef, t]
  )
}

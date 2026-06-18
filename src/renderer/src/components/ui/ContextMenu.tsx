import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

/**
 * Minimal custom context menu. Wrap a region in <ContextMenuProvider>; children
 * register menu items via the `useContextMenu` hook + <MenuTrigger>. We roll our
 * own instead of pulling in Radix to stay dependency-light.
 */

interface MenuPosition {
  x: number
  y: number
}

interface MenuItemDef {
  id: string
  label: string
  /** Optional shortcut hint shown right-aligned (e.g. "⌘V"). */
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  separatorAfter?: boolean
}

interface MenuState {
  position: MenuPosition
  items: MenuItemDef[]
}

const MenuContext = createContext<{
  open: (e: React.MouseEvent, items: MenuItemDef[]) => void
} | null>(null)

export function ContextMenuProvider({ children }: { children: ReactNode }): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const open = useCallback((e: React.MouseEvent, items: MenuItemDef[]): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ position: { x: e.clientX, y: e.clientY }, items })
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', (ev) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) close()
    })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <MenuContext.Provider value={{ open }}>
      {children}
      {menu && (
        <div
          ref={ref}
          className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-bg-surface py-1 shadow-xl"
          style={{ left: menu.position.x, top: menu.position.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.items.map((item) => (
            <div key={item.id}>
              <button
                disabled={item.disabled}
                onClick={() => {
                  item.onClick()
                  setMenu(null)
                }}
                className={`flex w-full items-center gap-6 px-3 py-1.5 text-left text-[13px] disabled:opacity-40 ${
                  item.danger
                    ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
                    : 'text-text hover:bg-bg-subtle'
                }`}
              >
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <span className="text-xs text-text-muted">{item.shortcut}</span>
                )}
              </button>
              {item.separatorAfter && <div className="my-1 border-t border-border" />}
            </div>
          ))}
        </div>
      )}
    </MenuContext.Provider>
  )
}

export function useContextMenu(): { open: (e: React.MouseEvent, items: MenuItemDef[]) => void } {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error('useContextMenu must be used within ContextMenuProvider')
  return ctx
}

export type { MenuItemDef }

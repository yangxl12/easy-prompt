import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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

interface MenuSubItemDef {
  id: string
  label: string
  onClick: () => void
  /** Tailwind class for a compact color swatch. */
  swatch?: string
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
  submenu?: MenuSubItemDef[]
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
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 })
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null)
  const [submenuPosition, setSubmenuPosition] = useState<MenuPosition>({ x: 0, y: 0 })
  const [submenuReady, setSubmenuReady] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const open = useCallback((e: React.MouseEvent, items: MenuItemDef[]): void => {
    e.preventDefault()
    e.stopPropagation()
    const nextPosition = { x: e.clientX, y: e.clientY }
    setPosition(nextPosition)
    setActiveSubmenuId(null)
    setSubmenuReady(false)
    setMenu({ position: nextPosition, items })
  }, [])

  // Keep menus fully inside the viewport. This matters most for rows near the
  // bottom of the file tree, where the old fixed top-left placement was clipped.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const next = {
      x: Math.max(4, Math.min(position.x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(position.y, window.innerHeight - rect.height - 4))
    }
    if (next.x !== position.x || next.y !== position.y) setPosition(next)
  }, [menu, position])

  useLayoutEffect(() => {
    if (!menu || !activeSubmenuId || !submenuRef.current) return
    const item = itemRefs.current.get(activeSubmenuId)
    if (!item) return
    const anchor = item.getBoundingClientRect()
    const submenu = submenuRef.current.getBoundingClientRect()
    const preferredX = anchor.right + 4
    const x =
      preferredX + submenu.width <= window.innerWidth - 4
        ? preferredX
        : anchor.left - submenu.width - 4
    const y = Math.max(4, Math.min(anchor.top, window.innerHeight - submenu.height - 4))
    setSubmenuPosition({
      x: Math.max(4, x),
      y
    })
    setSubmenuReady(true)
  }, [activeSubmenuId, menu, position])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    const onContextMenu = (ev: MouseEvent): void => {
      if (ref.current && !ref.current.contains(ev.target as Node)) close()
    }
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <MenuContext.Provider value={{ open }}>
      {children}
      {menu && (
        <div
          ref={ref}
          className="fixed z-[100] min-w-[180px] rounded-lg border border-border bg-bg-surface py-1 shadow-xl"
          style={{ left: position.x, top: position.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.items.map((item) => (
            <div
              key={item.id}
              ref={(element) => {
                if (element) itemRefs.current.set(item.id, element)
                else itemRefs.current.delete(item.id)
              }}
              onMouseEnter={() => {
                setActiveSubmenuId(item.submenu ? item.id : null)
                setSubmenuReady(false)
              }}
            >
              <button
                disabled={item.disabled}
                // Keep the context target focused. Editor commands, especially
                // Select All, must leave their selection visible after clicking.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  item.onClick()
                  if (!item.submenu) setMenu(null)
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
                {item.submenu && <span className="ml-2 text-xs text-text-muted">›</span>}
              </button>
              {item.separatorAfter && <div className="my-1 border-t border-border" />}
            </div>
          ))}
          {activeSubmenuId &&
            menu.items.find((item) => item.id === activeSubmenuId)?.submenu && (
              <div
                ref={submenuRef}
                className="fixed z-[110] flex min-w-0 gap-1 rounded-lg border border-border bg-bg-surface p-1.5 shadow-xl"
                style={{
                  left: submenuPosition.x,
                  top: submenuPosition.y,
                  visibility: submenuReady ? 'visible' : 'hidden'
                }}
                onMouseEnter={() => setSubmenuReady(true)}
              >
                {menu.items
                  .find((item) => item.id === activeSubmenuId)
                  ?.submenu?.map((subitem) => (
                    <button
                      key={subitem.id}
                      title={subitem.label}
                      aria-label={subitem.label}
                      onClick={() => {
                        setMenu(null)
                        setActiveSubmenuId(null)
                        subitem.onClick()
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded hover:bg-bg-subtle"
                    >
                      <span
                        className={`h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/25 ${subitem.swatch ?? 'bg-text'}`}
                      />
                    </button>
                  ))}
              </div>
            )}
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

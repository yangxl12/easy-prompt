import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore, type Tab } from '../../store/workspace'
import { CloseIcon, EyeIcon, FileIcon } from '../ui/icons'
import { useContextMenu, type MenuItemDef } from '../ui/ContextMenu'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TabRect {
  left: number
  width: number
}

interface DragState {
  fromIndex: number
  /** Path of the dragged tab — used to suppress click-activation after drag. */
  fromPath: string
  toIndex: number
  /** Accumulated pointer delta from drag-start (px). */
  offsetX: number
  /** Width of the dragged tab (px). */
  tabWidth: number
  /** Container-relative left of every tab at drag-start. */
  positions: TabRect[]
}

// ---------------------------------------------------------------------------
// TabBar
// ---------------------------------------------------------------------------

/**
 * Horizontal tab strip with pointer-based drag-and-drop reordering.
 *
 * Constraints:
 * - Drag is horizontal only, confined inside the tab-bar bounds.
 * - Non-dragged tabs animate smoothly ("挤开" / make-room effect) via CSS
 *   transitions on `transform`.
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
  const moveTab = useWorkspaceStore((s) => s.moveTab)
  const closeOtherTabs = useWorkspaceStore((s) => s.closeOtherTabs)
  const closeTabsToRight = useWorkspaceStore((s) => s.closeTabsToRight)
  const { open: openMenu } = useContextMenu()

  const handleClose = onRequestClose ?? closeTab

  /** Right-click context menu on a tab. */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isLast: boolean): void => {
      const items: MenuItemDef[] = [
        {
          id: 'close',
          label: t('tabs.close'),
          onClick: () => handleClose(path)
        },
        {
          id: 'close-right',
          label: t('tabs.closeRight'),
          disabled: isLast,
          onClick: () => closeTabsToRight(path)
        },
        {
          id: 'close-others',
          label: t('tabs.closeOthers'),
          disabled: tabs.length <= 1,
          onClick: () => closeOtherTabs(path)
        }
      ]
      openMenu(e, items)
    },
    [t, handleClose, closeTabsToRight, closeOtherTabs, tabs.length, openMenu]
  )

  // Refs -----------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null)
  /** Map path → DOM element for measuring tab rects. */
  const tabEls = useRef<Map<string, HTMLDivElement>>(new Map())

  // Drag state -----------------------------------------------------
  const [drag, setDrag] = useState<DragState | null>(null)
  // Mirror drag in a ref so pointer-move/up listeners see fresh values
  // without re-registering on every frame.
  const dragRef = useRef<DragState | null>(null)
  /** When non-null, holds the path of the tab that was just dragged.
   * The next click on this tab will be suppressed to avoid activating
   * after a drag-and-drop. Reset on any click. */
  const hasDragged = useRef<string | null>(null)

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  /** Measure every tab's container-relative rect (accounts for scroll). */
  const measureTabs = useCallback((): TabRect[] => {
    const container = containerRef.current
    if (!container) return []
    const cr = container.getBoundingClientRect()
    const scrollLeft = container.scrollLeft
    return tabs.map((tb) => {
      const el = tabEls.current.get(tb.path)
      if (!el) return { left: 0, width: 0 }
      const r = el.getBoundingClientRect()
      return {
        left: r.left - cr.left + scrollLeft,
        width: r.width
      }
    })
  }, [tabs])

  /** Compute the target index given the current drag offset.
   *  Uses edge-based comparison: rightward → left edge of each target;
   *  leftward → right edge of each target.  This is equivalent to the
   *  midpoint between adjacent flex items (they have no gap). */
  const computeTargetIndex = useCallback(
    (fromIndex: number, offsetX: number, positions: TabRect[]): number => {
      const dragWidth = positions[fromIndex]?.width ?? 0
      const dragCenter = positions[fromIndex].left + dragWidth / 2 + offsetX
      let toIndex = fromIndex

      if (offsetX > 0) {
        // Moving right: overtake when centre passes the LEFT edge of a tab.
        for (let i = fromIndex + 1; i < tabs.length; i++) {
          if (dragCenter > positions[i].left) toIndex = i
        }
      } else if (offsetX < 0) {
        // Moving left: overtake when centre passes the RIGHT edge of a tab.
        for (let i = fromIndex - 1; i >= 0; i--) {
          const targetRight = positions[i].left + positions[i].width
          if (dragCenter < targetRight) toIndex = i
        }
      }

      return toIndex
    },
    [tabs.length]
  )

  /** Clamp offset so the dragged tab stays inside the tab-bar.
   *  The upper bound allows the LEFT edge of the dragged tab to reach the
   *  RIGHT edge of the last tab — this gives enough reach to push past
   *  even a narrow last tab. */
  const clampOffset = useCallback(
    (offsetX: number, fromIndex: number, positions: TabRect[]): number => {
      const container = containerRef.current
      if (!container) return offsetX
      const tabLeft = positions[fromIndex]?.left ?? 0

      // Total scrollable content width
      const last = positions[positions.length - 1]
      const contentWidth = last ? last.left + last.width : container.clientWidth

      const minOffset = -tabLeft
      // Allow the dragged tab's left edge to reach the right edge of the
      // content, so its centre can always pass any tab's left edge.
      const maxOffset = Math.max(0, contentWidth - tabLeft)

      return Math.min(Math.max(offsetX, minOffset), maxOffset)
    },
    []
  )

  // -----------------------------------------------------------------
  // Pointer event handlers
  // -----------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      // Only trigger on left button; ignore clicks on close button.
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest('button')) return // close button

      // Prevent text selection during drag
      e.preventDefault()

      const positions = measureTabs()
      const tabWidth = positions[index]?.width ?? 0

      const state: DragState = {
        fromIndex: index,
        fromPath: tabs[index]?.path ?? '',
        toIndex: index,
        offsetX: 0,
        tabWidth,
        positions
      }

      dragRef.current = state
      // Reset drag-suppression flag — we'll set it once pointer moves enough.
      hasDragged.current = null
      setDrag(state)

      // Capture pointer so we get events even outside the element.
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [measureTabs]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const current = dragRef.current
      if (!current) return

      // Accumulate delta
      const deltaX = e.movementX
      const nextOffset = current.offsetX + deltaX

      // Once the pointer moves far enough, flag as a real drag.
      if (Math.abs(nextOffset) > 3 && hasDragged.current === null) {
        hasDragged.current = current.fromPath
      }

      // Clamp
      const clamped = clampOffset(nextOffset, current.fromIndex, current.positions)

      // Compute target index
      const toIndex = computeTargetIndex(current.fromIndex, clamped, current.positions)

      const next: DragState = {
        ...current,
        offsetX: clamped,
        toIndex
      }

      dragRef.current = next
      setDrag(next)
    },
    [clampOffset, computeTargetIndex]
  )

  const endDrag = useCallback(() => {
    const current = dragRef.current
    if (!current) return

    // Clear drag state first so no render sees new tab order + old drag
    // indices (which would apply wrong transforms and cause visual glitches).
    // This is safe because transition is 'none' when drag is null — no bounce.
    dragRef.current = null
    setDrag(null)

    // Commit the reorder if the tab actually moved.
    if (current.toIndex !== current.fromIndex) {
      moveTab(current.fromIndex, current.toIndex)
    }
  }, [moveTab])

  const handlePointerUp = useCallback(
    (_e: React.PointerEvent) => {
      endDrag()
    },
    [endDrag]
  )

  // If the pointer leaves the window entirely we still want to finish.
  useEffect(() => {
    const onLost = (): void => {
      if (dragRef.current) endDrag()
    }
    window.addEventListener('pointerup', onLost)
    return () => window.removeEventListener('pointerup', onLost)
  }, [endDrag])

  // -----------------------------------------------------------------
  // Compute per-tab transform
  // -----------------------------------------------------------------

  const getTransform = useCallback(
    (index: number): string => {
      if (!drag) return ''
      const { fromIndex, toIndex, offsetX, tabWidth } = drag

      if (index === fromIndex) {
        // Dragged tab — follow the cursor.
        return `translateX(${offsetX}px)`
      }

      // Non-dragged tabs: shift away from the gap.
      if (toIndex > fromIndex && index > fromIndex && index <= toIndex) {
        // Shift left to make room on the right.
        return `translateX(${-tabWidth}px)`
      }
      if (toIndex < fromIndex && index >= toIndex && index < fromIndex) {
        // Shift right to make room on the left.
        return `translateX(${tabWidth}px)`
      }

      return ''
    },
    [drag]
  )

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  if (tabs.length === 0) {
    return <div className="h-9 shrink-0 border-b border-border bg-bg-surface" />
  }

  const isDragging = drag !== null

  return (
    <div
      ref={containerRef}
      className={`flex h-9 shrink-0 items-stretch border-b border-border bg-bg-surface select-none ${
        isDragging ? 'overflow-hidden' : 'overflow-x-auto'
      }`}
    >
      {tabs.map((tab, index) => (
        <TabButton
          key={tab.path}
          tab={tab}
          active={tab.path === activePath}
          title={t('tabs.close')}
          onActivate={() => {
            if (hasDragged.current) {
              const wasDragged = hasDragged.current === tab.path
              hasDragged.current = null
              if (wasDragged) return
            }
            setActive(tab.path)
          }}
          onClose={() => handleClose(tab.path)}
          onPointerDown={(e) => handlePointerDown(e, index)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          transform={getTransform(index)}
          isDragged={drag?.fromIndex === index}
          isAnyDragging={drag !== null}
          onContextMenu={(e) => handleContextMenu(e, tab.path, index === tabs.length - 1)}
          tabRef={(el) => {
            if (el) tabEls.current.set(tab.path, el)
            else tabEls.current.delete(tab.path)
          }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TabButton
// ---------------------------------------------------------------------------

function TabButton({
  tab,
  active,
  title,
  onActivate,
  onClose,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  transform,
  isDragged,
  isAnyDragging,
  onContextMenu,
  tabRef
}: {
  tab: Tab
  active: boolean
  title: string
  onActivate: () => void
  onClose: () => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  transform: string
  isDragged: boolean
  isAnyDragging: boolean
  onContextMenu: (e: React.MouseEvent) => void
  tabRef: (el: HTMLDivElement | null) => void
}): JSX.Element {
  const dirty = tab.dirtyContent !== null
  const isPreview = tab.readOnly === true

  return (
    <div
      ref={tabRef}
      onClick={onActivate}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          onClose()
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      style={{
        transform: transform || undefined,
        transition: isAnyDragging && !isDragged ? 'transform 0.15s ease' : 'none',
        zIndex: isDragged ? 10 : undefined,
        position: 'relative',
        touchAction: 'none'
      }}
      className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-[13px] ${
        active ? 'bg-bg-base text-text' : 'text-text-muted hover:bg-bg-subtle'
      } ${
        isDragged ? 'shadow-lg opacity-90' : ''
      }`}
    >
      <FileIcon width={13} height={13} className="opacity-60" />
      <span className="max-w-[160px] truncate pointer-events-none">{tab.name}</span>
      {isPreview && (
        <EyeIcon width={12} height={12} className="opacity-40 pointer-events-none" />
      )}
      {dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent pointer-events-none" />}
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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  /** Initial left size as percentage (0-100). */
  initialLeft?: number
  /** Min sizes in percent. */
  minLeft?: number
  minRight?: number
}

/**
 * Horizontal split with a draggable divider. The divider width is 1px visually
 * with a larger grab area. Pure client-side, no external lib.
 */
export default function SplitPane({
  left,
  right,
  initialLeft = 50,
  minLeft = 20,
  minRight = 20
}: SplitPaneProps): JSX.Element {
  const [leftPct, setLeftPct] = useState(initialLeft)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onMove = useCallback(
    (clientX: number): void => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = ((clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(100 - minRight, Math.max(minLeft, pct)))
    },
    [minLeft, minRight]
  )

  useEffect(() => {
    const mouseMove = (e: MouseEvent): void => {
      if (dragging.current) onMove(e.clientX)
    }
    const mouseUp = (): void => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', mouseMove)
    window.addEventListener('mouseup', mouseUp)
    return () => {
      window.removeEventListener('mousemove', mouseMove)
      window.removeEventListener('mouseup', mouseUp)
    }
  }, [onMove])

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      <div style={{ width: `${leftPct}%` }} className="min-w-0 overflow-hidden">
        {left}
      </div>
      <div
        onMouseDown={(e) => {
          e.preventDefault()
          dragging.current = true
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
        className="group relative w-px shrink-0 cursor-col-resize bg-border"
      >
        {/* Wider invisible grab area */}
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        <div className="absolute inset-y-0 left-0 w-px bg-accent opacity-0 group-hover:opacity-100" />
      </div>
      <div style={{ width: `${100 - leftPct}%` }} className="min-w-0 overflow-hidden">
        {right}
      </div>
    </div>
  )
}

import { useLayoutEffect, useRef, useState, type UIEvent } from 'react'
import css from './DesktopVirtualList.module.css'

export interface VirtualWindow {
  start: number
  end: number
}

/** Calculate the visible item range for a fixed-height virtual list. */
export function getVirtualWindow(
  itemCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 4,
): VirtualWindow {
  if (itemCount <= 0) return { start: 0, end: 0 }
  const safeRowHeight = Math.max(1, rowHeight)
  const safeOverscan = Math.max(0, Math.floor(overscan))
  const safeViewportHeight = Math.max(0, viewportHeight)
  const safeScrollTop = Math.min(Math.max(0, scrollTop), Math.max(0, itemCount * safeRowHeight - safeViewportHeight))
  const first = Math.max(0, Math.floor(safeScrollTop / safeRowHeight) - safeOverscan)
  const last = Math.min(itemCount, Math.ceil((safeScrollTop + safeViewportHeight) / safeRowHeight) + safeOverscan)
  return { start: first, end: Math.max(first, last) }
}

interface DesktopVirtualListProps<T> {
  items: readonly T[]
  rowHeight: number
  overscan?: number
  className?: string | undefined
  renderItem: (item: T, index: number) => React.ReactNode
}

/** Render fixed-height rows while keeping the scroll surface proportional to the full collection. */
export function DesktopVirtualList<T>({
  items,
  rowHeight,
  overscan,
  className,
  renderItem,
}: DesktopVirtualListProps<T>): React.ReactElement {
  const viewport = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(320)
  const window = getVirtualWindow(items.length, rowHeight, scrollTop, viewportHeight, overscan)
  const safeRowHeight = Math.max(1, rowHeight)

  useLayoutEffect(() => {
    const element = viewport.current
    if (element === null) return
    const updateHeight = (): void => { setViewportHeight(element.clientHeight || 320) }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    setScrollTop(event.currentTarget.scrollTop)
  }

  return (
    <div ref={viewport} className={`${css.viewport}${className === undefined ? '' : ` ${className}`}`} onScroll={handleScroll}>
      <div className={css.canvas} style={{ height: `${items.length * safeRowHeight}px` }}>
        <div className={css.rows} style={{ transform: `translateY(${window.start * safeRowHeight}px)` }}>
          {items.slice(window.start, window.end).map((item, offset) => renderItem(item, window.start + offset))}
        </div>
      </div>
    </div>
  )
}

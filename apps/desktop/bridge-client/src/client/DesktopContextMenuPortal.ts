// Desktop context-menu portal: the fixed-position menu element, viewport
// clamping with edge flipping, roving-focus keyboard navigation, and the
// full set of close triggers. The menu is a desktop-owned body portal — the
// production right-click suppression hands control here instead of restoring
// the browser's uncontrolled menu.

import type { ContextMenuItem } from './DesktopContextMenu.ts'

/** The menu root element's stable id (one portal per page). */
const MENU_ID = 'dsh-desktop-context-menu'
/** Gap from the viewport edge before the menu flips or clamps. */
const EDGE_GAP = 4

/** A menu opened at one pointer position with its items. */
export interface OpenMenuOptions {
  x: number
  y: number
  items: ContextMenuItem[]
  /** Closes the menu; called exactly once on every close path. */
  onClose: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Open the context menu at the given pointer position. Returns the disposer
 * that closes the menu (idempotent). The menu clamps to the visual viewport
 * and flips away from the lower and right edges when it would overflow.
 * @param options - pointer position, items, and the close callback.
 * @returns the disposer; call it on plugin disposal or session navigation.
 */
export function openContextMenu(options: OpenMenuOptions): () => void {
  closeExistingMenu()
  const root = document.createElement('div')
  root.id = MENU_ID
  root.setAttribute('role', 'menu')
  root.setAttribute('aria-label', 'Desktop actions')
  root.tabIndex = -1
  root.style.cssText = [
    'position:fixed;z-index:2147483646;min-width:160px;padding:4px;border-radius:8px;',
    'background:var(--dsw-alias-bg-base,#0f1117);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));',
    'box-shadow:0 8px 24px rgba(0,0,0,0.4);font-family:var(--dsw-font-family,system-ui,sans-serif);',
    'font-size:13px;color:var(--dsw-alias-label-primary,#e6e8ee);user-select:none;',
  ].join('')
  let closed = false
  let focusIndex = 0
  let itemElements: HTMLButtonElement[] = []

  const close = (): void => {
    if (closed) return
    closed = true
    window.removeEventListener('pointerdown', onOutsidePointer, true)
    window.removeEventListener('resize', close)
    document.removeEventListener('scroll', close, true)
    window.removeEventListener('blur', onWindowBlur)
    window.removeEventListener('keydown', onKeyDown, true)
    root.remove()
    options.onClose()
  }

  const onOutsidePointer = (event: PointerEvent): void => {
    if (root.contains(event.target as Node)) return
    close()
  }
  const onWindowBlur = (): void => {
    // A WebView focus loss (window switch) closes the menu.
    close()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        close()
        return
      case 'ArrowDown':
        event.preventDefault()
        moveFocus(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveFocus(-1)
        return
      case 'Home':
        event.preventDefault()
        moveFocus(-itemElements.length)
        return
      case 'End':
        event.preventDefault()
        moveFocus(itemElements.length)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        const current = itemElements[focusIndex]
        if (current !== undefined && !current.disabled) {
          current.click()
        }
        return
      default:
        return
    }
  }
  const moveFocus = (delta: number): void => {
    if (itemElements.length === 0) return
    const enabled = itemElements.filter(item => !item.disabled)
    if (enabled.length === 0) return
    let next = (focusIndex + delta) % itemElements.length
    if (next < 0) next += itemElements.length
    while (itemElements[next]!.disabled) {
      next = (next + delta) % itemElements.length
      if (next < 0) next += itemElements.length
    }
    focusIndex = next
    itemElements[next]!.focus()
  }

  for (const item of options.items) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsh-context-menu-item'
    button.textContent = item.label
    button.disabled = !item.enabled
    button.setAttribute('role', 'menuitem')
    button.style.cssText = [
      'display:block;width:100%;text-align:left;border:0;padding:6px 10px;border-radius:5px;',
      'background:transparent;color:inherit;font:inherit;cursor:pointer;',
    ].join('')
    button.addEventListener('mouseenter', () => {
      if (!button.disabled) {
        button.focus()
        focusIndex = itemElements.indexOf(button)
      }
    })
    button.addEventListener('click', () => {
      const keepOpen = item.run() === false
      if (!keepOpen) close()
    })
    root.appendChild(button)
    itemElements.push(button)
  }
  document.body.appendChild(root)

  // Position after insertion so measured dimensions are final.
  const rect = root.getBoundingClientRect()
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  let left = options.x
  let top = options.y
  if (left + rect.width > viewportWidth - EDGE_GAP) left = options.x - rect.width
  if (top + rect.height > viewportHeight - EDGE_GAP) top = options.y - rect.height
  left = clamp(left, EDGE_GAP, Math.max(EDGE_GAP, viewportWidth - rect.width - EDGE_GAP))
  top = clamp(top, EDGE_GAP, Math.max(EDGE_GAP, viewportHeight - rect.height - EDGE_GAP))
  root.style.left = `${left}px`
  root.style.top = `${top}px`
  root.focus()
  itemElements[0]?.focus()

  window.addEventListener('pointerdown', onOutsidePointer, true)
  window.addEventListener('resize', close)
  document.addEventListener('scroll', close, true)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('keydown', onKeyDown, true)
  return close
}

/** Close any open desktop context menu (used on session navigation and disposal). */
export function closeExistingMenu(): void {
  const existing = document.getElementById(MENU_ID)
  existing?.remove()
}

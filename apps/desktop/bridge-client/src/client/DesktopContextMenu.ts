// Desktop-owned context menu (P3 of the Desktop 0.4 plan).
//
// Replaces the production right-click suppression with one desktop-owned
// body portal. Right-clicking selected readable text offers Copy; right-
// clicking the active conversation composer offers Cut/Copy/Paste according
// to selection, disabled/read-only state, and clipboard capability. Inputs
// outside the conversation composer receive only Copy so password, settings,
// and confirmation fields do not gain an accidental mutation path. The menu
// closes on action, Escape, outside pointer input, scroll, resize, focus
// loss, session navigation, or plugin disposal; keyboard navigation uses
// roving focus with Up/Down/Home/End/Enter/Space. Placement clamps to the
// visual viewport and flips away from the lower and right edges. Debug mode
// may expose an explicit Inspect item after the product actions.

/** One menu item. */
export interface ContextMenuItem {
  id: string
  label: string
  enabled: boolean
  /** Run the action; returns whether the menu should close. */
  run: () => boolean | void
}

/** Why a right-click target gets a menu. */
export type ContextMenuKind =
  | { kind: 'composer' }
  | { kind: 'editable-outside' }
  | { kind: 'readable-selection' }
  | { kind: 'none' }

/** Classify a right-click target into a menu kind. */
export function classifyTarget(target: EventTarget | null): ContextMenuKind {
  if (!(target instanceof Element)) return { kind: 'none' }
  const composer = target.closest('[data-composer-card]')
  if (composer !== null) return { kind: 'composer' }
  const editable = target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')
  if (editable !== null) return { kind: 'editable-outside' }
  const selection = window.getSelection()
  if (selection !== null && !selection.isCollapsed && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    if (range.intersectsNode(target)) return { kind: 'readable-selection' }
  }
  return { kind: 'none' }
}

/**
 * Build the items for one menu kind. The caller (the apply closure) supplies
 * the action implementations so they can close over real DOM state.
 * @param kind - the classified target kind.
 * @param actions - the action implementations.
 * @param debugMode - whether the explicit Inspect item is exposed.
 * @returns the ordered menu items.
 */
export function buildMenuItems(
  kind: ContextMenuKind,
  actions: {
    cut: () => void
    copy: () => void
    paste: () => Promise<unknown>
    inspect: () => void
  },
  debugMode: boolean,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  if (kind.kind === 'composer') {
    items.push({ id: 'cut', label: 'Cut', enabled: true, run: () => { actions.cut() } })
    items.push({ id: 'copy', label: 'Copy', enabled: true, run: () => { actions.copy() } })
    items.push({
      id: 'paste',
      label: 'Paste',
      enabled: true,
      run: () => { void actions.paste() },
    })
  } else if (kind.kind === 'editable-outside' || kind.kind === 'readable-selection') {
    items.push({ id: 'copy', label: 'Copy', enabled: true, run: () => { actions.copy() } })
  }
  if (debugMode) {
    items.push({ id: 'inspect', label: 'Inspect', enabled: true, run: () => { actions.inspect() } })
  }
  return items
}

/**
 * Copy selected text to the clipboard. Falls back to the legacy execCommand
 * path where the async clipboard API is unavailable or denied.
 * @returns whether the copy was accepted.
 */
export async function copySelection(): Promise<boolean> {
  const selection = window.getSelection()
  const text = selection === null ? '' : selection.toString()
  if (text.length === 0) return false
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy path below.
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const accepted = document.execCommand('copy')
    textarea.remove()
    return accepted
  } catch {
    return false
  }
}

/**
 * Paste text into the active composer, replacing the current selection.
 * Reads text only (never files or HTML) and preserves React control through
 * the native value setter plus a bubbling input event. Uses setRangeText when
 * the textarea supports it so the selection replacement matches user intent.
 * @returns whether the paste was accepted.
 */
export async function pasteIntoComposer(): Promise<boolean> {
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (textarea === null || textarea.disabled || textarea.readOnly) return false
  let text: string | undefined
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      const value = await navigator.clipboard.readText()
      if (value.length > 0) text = value
    } catch {
      // No clipboard read permission: report failure below.
    }
  }
  if (text === undefined) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter === undefined) return false
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const next = textarea.value.slice(0, start) + text + textarea.value.slice(end)
  setter.call(textarea, next)
  try {
    textarea.setSelectionRange(start + text.length, start + text.length)
  } catch {
    /* selection restore is best-effort */
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

/**
 * Cut the active composer selection to the clipboard and remove it.
 * @returns whether the cut was accepted.
 */
export async function cutFromComposer(): Promise<boolean> {
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (textarea === null || textarea.disabled || textarea.readOnly) return false
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  if (end <= start) return false
  const cut = textarea.value.slice(start, end)
  if (cut.length === 0) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter === undefined) return false
  // Write the cut text first; then remove the selection.
  let wrote = false
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(cut)
      wrote = true
    } catch {
      /* fall through to the legacy path below */
    }
  }
  if (!wrote) {
    const temp = document.createElement('textarea')
    temp.value = cut
    temp.style.position = 'fixed'
    temp.style.opacity = '0'
    document.body.appendChild(temp)
    temp.select()
    document.execCommand('copy')
    temp.remove()
  }
  const next = textarea.value.slice(0, start) + textarea.value.slice(end)
  setter.call(textarea, next)
  try {
    textarea.setSelectionRange(start, start)
  } catch {
    /* selection restore is best-effort */
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

/**
 * Copy the active composer selection to the clipboard without removing it.
 * @returns whether the copy was accepted.
 */
export async function copyFromComposer(): Promise<boolean> {
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (textarea === null) return false
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  if (end <= start) return false
  const text = textarea.value.slice(start, end)
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through to the legacy path below */
    }
  }
  try {
    const temp = document.createElement('textarea')
    temp.value = text
    temp.style.position = 'fixed'
    temp.style.opacity = '0'
    document.body.appendChild(temp)
    temp.select()
    const accepted = document.execCommand('copy')
    temp.remove()
    return accepted
  } catch {
    return false
  }
}

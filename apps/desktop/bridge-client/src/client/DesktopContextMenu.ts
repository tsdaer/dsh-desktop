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

import { pasteTextIntoComposer } from './DesktopComposerPaste.ts'

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
  | { kind: 'composer'; editable: boolean; hasSelection: boolean }
  | { kind: 'editable-outside' }
  | { kind: 'readable-selection' }
  | { kind: 'none' }

/** Localized labels supplied by the bridge locale binding. */
export interface ContextMenuLabels {
  cut: string
  copy: string
  paste: string
  inspect: string
}

function composerInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-card] [data-composer-input]')
}

function isEditable(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly
  }
  return element.getAttribute('contenteditable') === 'true' || element.contentEditable === 'true'
}

function selectionIntersects(selection: Selection | null, target: Node): boolean {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false
  try {
    return selection.getRangeAt(0).intersectsNode(target)
  } catch {
    return false
  }
}

/** Classify a right-click target into a menu kind. */
export function classifyTarget(target: EventTarget | null): ContextMenuKind {
  if (!(target instanceof Element)) return { kind: 'none' }
  const composer = target.closest('[data-composer-card]')
  const input = target.closest<HTMLElement>('[data-composer-input]')
  if (composer !== null && input !== null && input.closest('[data-composer-card]') === composer) {
    return {
      kind: 'composer',
      editable: isEditable(input),
      hasSelection: selectionIntersects(window.getSelection(), input),
    }
  }
  const editable = target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')
  if (editable !== null) return { kind: 'editable-outside' }
  const selection = window.getSelection()
  if (selectionIntersects(selection, target)) return { kind: 'readable-selection' }
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
  labels: ContextMenuLabels = { cut: 'Cut', copy: 'Copy', paste: 'Paste', inspect: 'Inspect' },
): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  if (kind.kind === 'composer') {
    if (kind.editable) {
      items.push({ id: 'cut', label: labels.cut, enabled: kind.hasSelection, run: () => { actions.cut() } })
      items.push({ id: 'copy', label: labels.copy, enabled: kind.hasSelection, run: () => { actions.copy() } })
      items.push({ id: 'paste', label: labels.paste, enabled: true, run: () => { void actions.paste() } })
    } else if (kind.hasSelection) {
      items.push({ id: 'copy', label: labels.copy, enabled: true, run: () => { actions.copy() } })
    }
  } else if (kind.kind === 'editable-outside' || kind.kind === 'readable-selection') {
    items.push({ id: 'copy', label: labels.copy, enabled: true, run: () => { actions.copy() } })
  }
  if (debugMode) {
    items.push({ id: 'inspect', label: labels.inspect, enabled: true, run: () => { actions.inspect() } })
  }
  return items
}

/** Copy one selected text string with the browser clipboard fallback. */
async function copyText(text: string): Promise<boolean> {
  if (text.length === 0) return false
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the browser's editing command.
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

/** Copy the current document selection to the clipboard. */
export async function copySelection(): Promise<boolean> {
  return copyText(window.getSelection()?.toString() ?? '')
}

/** Paste plain text through the Lexical composer's own paste command. */
export async function pasteIntoComposer(): Promise<boolean> {
  const input = composerInput()
  if (input === null || !isEditable(input)) return false
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false
  try {
    const text = await navigator.clipboard.readText()
    return text.length > 0 && pasteTextIntoComposer(text)
  } catch {
    return false
  }
}

/** Cut the current Lexical selection through the browser editing command. */
export async function cutFromComposer(): Promise<boolean> {
  const input = composerInput()
  if (input === null || !isEditable(input) || !selectionIntersects(window.getSelection(), input)) return false
  input.focus({ preventScroll: true })
  try {
    if (document.execCommand('cut')) return true
  } catch {
    // The editing command is unavailable in some test and WebView shells.
  }
  return false
}

/** Copy the current selection inside the active Lexical composer. */
export async function copyFromComposer(): Promise<boolean> {
  const input = composerInput()
  if (input === null || !selectionIntersects(window.getSelection(), input)) return false
  return copySelection()
}

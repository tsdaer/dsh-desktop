/**
 * Desktop-owned path insertion into the Lexical composer.
 *
 * The composer is a Lexical contenteditable (`[data-composer-input]`), not a
 * textarea: writing `.value` plus an `input` event no longer reaches the
 * editor. Paths re-enter through the product's own paste pipeline — a
 * synthetic `paste` event carrying text/plain clipboard data on the composer
 * surface — which the composer keymap (CRITICAL priority) routes through the
 * shell's paste verb: caret insertion, its own undo boundary, and the trigger
 * re-track. This mirrors the image route, which already re-enters as a
 * synthetic drop.
 */

/** The live composer input surface, or null when no composer is mounted. */
function composerInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-card] [data-composer-input]')
}

/**
 * Build a paste event carrying `text` as text/plain. Engines with native
 * ClipboardEvent/DataTransfer (WebView2, Chromium) get the real classes;
 * jsdom tests fall back to the duck-typed shape the composer keymap reads
 * (`clipboardData.items` plus `getData('text/plain')`).
 * @param text - the plain-text payload.
 * @returns a bubbling, cancelable paste event.
 */
function buildPathPasteEvent(text: string): Event {
  if (typeof ClipboardEvent === 'function' && typeof DataTransfer === 'function') {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    return new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
  }
  const payload = {
    items: [],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  }
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: payload })
  return event
}

/**
 * Insert filesystem paths into the live composer as text (one per line). The
 * surface is focused (restoring the last caret) and the paste is dispatched
 * through the composer's own pipeline, so the draft feeds the input machine
 * like any user paste. Read-only states (removed session, no workspace, owner
 * block, busy admission) render `contenteditable="false"` on the same
 * element and refuse the insertion (the attribute is the gate because jsdom
 * lacks the `isContentEditable` accessor).
 * @param paths - filesystem paths to insert.
 * @returns whether a live, editable composer accepted the insertion.
 */
export function insertPathsIntoComposer(paths: readonly string[]): boolean {
  const input = composerInput()
  // jsdom lacks the isContentEditable accessor, so gate on the attribute
  // React renders for the editable surface (`contenteditable="true"`).
  if (input === null || input.getAttribute('contenteditable') !== 'true') return false
  input.focus({ preventScroll: true })
  input.dispatchEvent(buildPathPasteEvent(paths.join('\n')))
  return true
}

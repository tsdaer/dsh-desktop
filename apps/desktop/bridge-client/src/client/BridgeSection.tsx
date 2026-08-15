// The bridge's own settings section: a nav entry beside General / Models
// (settings.section list slot) hosting the policy and debug-mode item
// slots. Types are duck-typed locally to keep the package free of
// cross-package build deps.

interface BridgeSectionProps {
  renderSlot(name: 'settings.bridge.item' | 'settings.bridge.item2', params: Record<string, unknown>): React.ReactNode
}

/**
 * Render the bridge settings section content column.
 * @param props - composed slot props (renderSlot share).
 * @returns the section element tree.
 */
export function BridgeSection({ renderSlot }: BridgeSectionProps) {
  return (
    <div>
      {renderSlot('settings.bridge.item', {})}
      {renderSlot('settings.bridge.item2', {})}
      <style>{'div[data-slot=\'settings.bridge.item\'] > :last-child, div[data-slot=\'settings.bridge.item2\'] > :last-child { border-bottom: none; }'}</style>
    </div>
  )
}

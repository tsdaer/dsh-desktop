// The bridge's own settings section: a nav entry beside General / Models
// (settings.section list slot) hosting the policy item slot. Types are
// duck-typed locally to keep the package free of cross-package build deps.

interface BridgeSectionProps {
  renderSlot(name: 'settings.bridge.item', params: Record<string, unknown>): React.ReactNode
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
      <style>{'div[data-slot=\'settings.bridge.item\'] > :last-child { border-bottom: none; }'}</style>
    </div>
  )
}

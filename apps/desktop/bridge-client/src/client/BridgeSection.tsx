// The bridge's own settings section: a nav entry beside General / Models
// (settings.section list slot) hosting the policy, debug-mode, logo-motion,
// and WSL environment item slots. Types are duck-typed locally to keep the
// package free of cross-package build deps.

interface BridgeSectionProps {
  renderSlot(name: 'settings.bridge.item' | 'settings.bridge.item2' | 'settings.bridge.item3' | 'settings.bridge.item4', params: Record<string, unknown>): React.ReactNode
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
      {renderSlot('settings.bridge.item3', {})}
      {renderSlot('settings.bridge.item4', {})}
      <style>{'div[data-slot=\'settings.bridge.item\'] > :last-child, div[data-slot=\'settings.bridge.item2\'] > :last-child, div[data-slot=\'settings.bridge.item3\'] > :last-child, div[data-slot=\'settings.bridge.item4\'] > :last-child { border-bottom: none; }'}</style>
    </div>
  )
}

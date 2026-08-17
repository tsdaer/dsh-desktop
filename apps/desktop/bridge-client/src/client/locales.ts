/** Desktop-settings dictionaries for the bridge settings section. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.nav': '桌面设置',
  'saving': '保存中…',
  'saveFailed': '保存失败: ',
  'close.title': '关闭行为',
  'close.toggle': '关闭窗口时最小化到托盘（不退出程序）',
  'close.hint': '开启后，点击标题栏关闭按钮会隐藏到系统托盘，可从托盘菜单恢复窗口或退出程序。',
  'debug.title': '调试模式',
  'debug.toggle': '开启调试模式（关闭时禁用右键菜单和 F12 等调试快捷键）',
} satisfies Record<string, string>

/** The desktop-settings namespace key union. */
export type BridgeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'section.nav': 'Desktop',
  'saving': 'Saving…',
  'saveFailed': 'Save failed: ',
  'close.title': 'Close behavior',
  'close.toggle': 'Minimize to the system tray when closing (do not exit)',
  'close.hint': 'When on, the title-bar close button hides the window to the tray; the tray menu restores the window or exits the app.',
  'debug.title': 'Debug mode',
  'debug.toggle': 'Enable debug mode (when off, disables the context menu and F12 debug shortcuts)',
} satisfies Record<BridgeKey, string>

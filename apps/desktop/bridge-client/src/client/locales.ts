/** Desktop-settings dictionaries for the bridge settings section. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.nav': '桌面设置',
  'saving': '保存中…',
  'saveFailed': '保存失败: ',
  'policy.title': '拖放策略',
  'policy.copy': '开启拖放复制（关闭时所有非图片文件只提供路径）',
  'policy.maxSize': '最大文件大小（MB）',
  'policy.hint': '图片始终直接进入输入框；开启复制时，未超限的文本文件会复制到 drops 文件夹（重复拖放会更新），二进制文件与超限文件只提供路径。',
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
  'policy.title': 'Drop policy',
  'policy.copy': 'Copy dropped files (when off, non-image files only provide a path)',
  'policy.maxSize': 'Maximum file size (MB)',
  'policy.hint': 'Images always go straight into the composer. When copy is on, in-limit text files are copied into the drops folder (a re-drop updates them); binaries and oversized files only provide a path.',
  'debug.title': 'Debug mode',
  'debug.toggle': 'Enable debug mode (when off, disables the context menu and F12 debug shortcuts)',
} satisfies Record<BridgeKey, string>

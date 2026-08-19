/** Desktop-settings dictionaries for the bridge settings section. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.nav': '桌面设置',
  'saving': '保存中…',
  'saveFailed': '保存失败: ',
  'close.title': '关闭按钮行为',
  'close.exit': '直接关闭并退出程序',
  'close.tray': '隐藏窗口并保留在系统托盘',
  'close.hint': '选择保留在托盘后，可从托盘菜单恢复窗口或退出程序。',
  'workspace.addConfirm': '“{path}”不属于任何工作区。是否将该目录添加为新工作区？',
  'workspace.addTitle': '添加工作区',
  'workspace.cancel': '取消',
  'workspace.add': '添加工作区',
  'workspace.addFailed': '添加工作区失败: ',
  'workbench.modeLabel': '工作区视图模式',
  'workbench.workspace': '工作区',
  'workbench.worktree': '项目文件',
  'workbench.empty': '项目文件视图尚未启用。',
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
  'close.title': 'Close button behavior',
  'close.exit': 'Close and exit the application',
  'close.tray': 'Hide the window and keep the application in the system tray',
  'close.hint': 'When kept in the tray, use the tray menu to restore the window or exit the application.',
  'workspace.addConfirm': '“{path}” is not inside a Workspace. Add this directory as a new Workspace?',
  'workspace.addTitle': 'Add Workspace',
  'workspace.cancel': 'Cancel',
  'workspace.add': 'Add Workspace',
  'workspace.addFailed': 'Failed to add Workspace: ',
  'workbench.modeLabel': 'Workspace view mode',
  'workbench.workspace': 'Workspace',
  'workbench.worktree': 'Worktree',
  'workbench.empty': 'The project-file view is not enabled yet.',
  'debug.title': 'Debug mode',
  'debug.toggle': 'Enable debug mode (when off, disables the context menu and F12 debug shortcuts)',
} satisfies Record<BridgeKey, string>

/** Locale-owned copy for the minimal desktop file preview entry. */

export interface DesktopPreviewCopy {
  binary: string
  failed: string
  invalidRequest: string
  unavailable: string
  invalidResponse: string
  copy: string
  copied: string
  close: string
  loading: string
  timeout: string
  truncated: string
  footnotes: string
}

const zh = {
  binary: '二进制文件，无法显示。',
  failed: '无法读取文件。',
  invalidRequest: '预览请求无效。',
  unavailable: '预览认证不可用。',
  invalidResponse: '预览响应无效。',
  copy: '复制',
  copied: '复制成功',
  close: '关闭',
  loading: '读取文件中…',
  timeout: '读取文件超时，请关闭窗口后重试。',
  truncated: '文件过大，仅显示前一部分。',
  footnotes: '脚注',
} satisfies DesktopPreviewCopy

const en = {
  binary: 'Binary file; content cannot be shown.',
  failed: 'The file could not be read.',
  invalidRequest: 'Invalid preview request.',
  unavailable: 'Preview authentication is unavailable.',
  invalidResponse: 'The preview response was invalid.',
  copy: 'Copy',
  copied: 'Copied',
  close: 'Close',
  loading: 'Loading file…',
  timeout: 'Loading timed out. Close the window and try again.',
  truncated: 'The file is large; only the beginning is shown.',
  footnotes: 'Footnotes',
} satisfies DesktopPreviewCopy

/** Select the preview dictionary for one HTML language tag. */
export function desktopPreviewCopy(language: string): DesktopPreviewCopy {
  return language.startsWith('zh') ? zh : en
}

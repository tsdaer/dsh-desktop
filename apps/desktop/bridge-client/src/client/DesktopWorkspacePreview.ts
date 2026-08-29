/** Pure projection rules shared by the desktop file viewer and the preview window. */

/** Presentation mode selected from a Workspace-relative file path. */
export type FilePreviewMode = 'markdown' | 'code'

/** Render-ready description of one bounded text file. */
export interface FilePreviewProjection {
  /** Workspace-relative path preserved for the request and visible context. */
  path: string
  /** Basename used as the preview title. */
  title: string
  /** Markdown or code presentation selected from the extension. */
  mode: FilePreviewMode
  /** Syntax language for recognized code files; unknown text has no hint. */
  language: string | undefined
  /** Source text used by the selected renderer. */
  content: string
}

/** Lowercased file-extension to syntax-highlighting language hint. */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  md: 'md', markdown: 'md', mdx: 'mdx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

/** Derive a syntax language hint from a path's final extension.
 * @param path - Workspace-relative or platform-style file path.
 * @returns the language id, or undefined for an unknown extension.
 */
export function langFromPath(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  return Object.hasOwn(LANG_BY_EXTENSION, ext) ? LANG_BY_EXTENSION[ext] : undefined
}

/** Whether the path names a Markdown-family document. */
function isMarkdownPath(path: string): boolean {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = base.slice(dot + 1).toLowerCase()
  return ext === 'md' || ext === 'markdown' || ext === 'mdx'
}

/** Find the longest consecutive occurrence of one Markdown fence character. */
function longestFenceRun(text: string, character: '`' | '~'): number {
  let longest = 0
  let current = 0
  for (const value of text) {
    current = value === character ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}

/** Wrap code in a collision-safe Markdown fence.
 * @param text - Untrusted file text.
 * @param language - Optional recognized language hint.
 * @returns Markdown containing the complete source as one code block.
 */
export function fenceCodeAsMarkdown(text: string, language: string | undefined): string {
  const backticks = Math.max(3, longestFenceRun(text, '`') + 1)
  const fence = '`'.repeat(backticks)
  const info = language ?? 'text'
  const suffix = text.endsWith('\n') ? '' : '\n'
  return `${fence}${info}\n${text}${suffix}${fence}`
}

/** Project one bounded Host file response into a renderer-neutral preview description.
 * @param path - Validated Workspace-relative file path.
 * @param text - Strictly decoded file text.
 * @returns The selected mode, title, language hint, and renderer input.
 */
export function projectFilePreview(path: string, text: string): FilePreviewProjection {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const title = path.slice(slash + 1) || path
  if (isMarkdownPath(path)) {
    return { path, title, mode: 'markdown', language: undefined, content: text }
  }
  const language = langFromPath(path)
  return { path, title, mode: 'code', language, content: fenceCodeAsMarkdown(text, language) }
}

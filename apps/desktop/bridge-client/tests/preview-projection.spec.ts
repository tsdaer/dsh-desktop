import { describe, expect, it } from 'vitest'
import { fenceCodeAsMarkdown, langFromPath, projectFilePreview } from '../src/client/DesktopWorkspacePreview.ts'

describe('desktop file preview projection', () => {
  it('passes Markdown through and derives its basename title', () => {
    expect(projectFilePreview('docs/README.md', '# Preview')).toEqual({
      path: 'docs/README.md',
      title: 'README.md',
      mode: 'markdown',
      language: undefined,
      content: '# Preview',
    })
  })

  it('maps recognized source files and wraps their source in a language fence', () => {
    const projection = projectFilePreview('src/main.ts', 'const value = 1')
    expect(projection.mode).toBe('code')
    expect(projection.language).toBe('ts')
    expect(projection.content).toBe('```ts\nconst value = 1\n```')
    expect(langFromPath('src/main.ts')).toBe('ts')
  })

  it('chooses a fence longer than source backtick runs', () => {
    const source = 'const fence = "````"\n'
    expect(fenceCodeAsMarkdown(source, 'ts')).toBe('`````ts\nconst fence = "````"\n`````')
  })

  it('uses a plain-text fence for unknown extensions and preserves platform basenames', () => {
    const projection = projectFilePreview('docs\\notes.data', 'plain text')
    expect(projection.title).toBe('notes.data')
    expect(projection.language).toBeUndefined()
    expect(projection.content).toBe('```text\nplain text\n```')
  })
})

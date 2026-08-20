import { afterEach, describe, expect, it } from 'vitest'
import { packageManagerInvocation } from './package-manager.ts'

const previous = process.env.npm_execpath

function withEntrypoint<T>(value: string | undefined, action: () => T): T {
  if (value === undefined) Reflect.deleteProperty(process.env, 'npm_execpath')
  else process.env.npm_execpath = value
  return action()
}

afterEach(() => {
  if (previous === undefined) Reflect.deleteProperty(process.env, 'npm_execpath')
  else process.env.npm_execpath = previous
})

describe('packageManagerInvocation', () => {
  it.each(['/repo/node_modules/pnpm/bin/pnpm.cjs', '/repo/pnpm.js', '/repo/pnpm.mjs'])(
    'loads the JavaScript entrypoint %s through Node',
    (entrypoint) => {
      const invocation = withEntrypoint(entrypoint, () => packageManagerInvocation(['run', 'build'], 'test'))

      expect(invocation).toEqual({ command: process.execPath, args: [entrypoint, 'run', 'build'] })
    },
  )

  it.each([
    'C:\\Users\\dev\\AppData\\Local\\pnpm\\pnpm.exe',
    '/home/dev/.local/share/pnpm/pnpm',
  ])('spawns the native executable %s directly', (entrypoint) => {
    const invocation = withEntrypoint(entrypoint, () => packageManagerInvocation(['run', 'build'], 'test'))

    expect(invocation).toEqual({ command: entrypoint, args: ['run', 'build'] })
  })

  it('never hands a native executable to Node, which would parse its header as source', () => {
    const invocation = withEntrypoint('/opt/pnpm/pnpm.exe', () => packageManagerInvocation([], 'test'))

    expect(invocation.command).not.toBe(process.execPath)
    expect(invocation.args).toEqual([])
  })

  it.each([undefined, ''])('rejects the unavailable entrypoint %o with the caller context', (entrypoint) => {
    expect(() => withEntrypoint(entrypoint, () => packageManagerInvocation([], 'run-gates')))
      .toThrow(/^run-gates: npm_execpath is unavailable/)
  })

  it('copies the argument list so callers cannot mutate a returned invocation', () => {
    const args = ['exec', 'vitest']
    const invocation = withEntrypoint('/opt/pnpm/pnpm', () => packageManagerInvocation(args, 'test'))
    args.push('--coverage')

    expect(invocation.args).toEqual(['exec', 'vitest'])
  })
})

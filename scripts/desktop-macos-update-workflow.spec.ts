import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('desktop macOS update acceptance workflow', () => {
  it('builds two immutable macOS tags and runs the signed target-native update smoke', () => {
    const workflow = loadWorkflow()
    if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs['macos-update'])) {
      throw new TypeError('desktop macOS update workflow must define macos-update')
    }
    const job = workflow.jobs['macos-update']
    const workflowJson = JSON.stringify(workflow)
    const jobJson = JSON.stringify(job)
    const stepRuns = Array.isArray(job.steps)
      ? job.steps
        .filter((step): step is Record<string, unknown> & { run: string } => isRecord(step) && typeof step.run === 'string')
        .map(step => step.run)
      : []
    const dispatch = isRecord(workflow.on) ? workflow.on.workflow_dispatch : undefined
    const inputs = isRecord(dispatch) ? dispatch.inputs : undefined

    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(isRecord(inputs)).toBe(true)
    expect(inputs).toMatchObject({
      base_ref: { required: true, type: 'string' },
      next_ref: { required: true, type: 'string' },
      port: { required: true, default: '4318', type: 'string' },
    })
    expect(job['runs-on']).toBe('macos-14')
    expect(jobJson).toContain('git show-ref --verify')
    expect(jobJson).toContain('git rev-parse --verify')
    expect(jobJson).toContain('BASE_COMMIT=')
    expect(jobJson).toContain('NEXT_COMMIT=')
    expect(jobJson).toContain('process.argv.slice(2)')
    expect(stepRuns.some(run => run.includes('test "$(git rev-parse HEAD)" = "$BASE_COMMIT"'))).toBe(true)
    expect(stepRuns.some(run => run.includes('git checkout --detach "$NEXT_COMMIT"'))).toBe(true)
    expect(stepRuns.some(run => run.includes('test "$(git rev-parse HEAD)" = "$NEXT_COMMIT"'))).toBe(true)
    expect(jobJson).toContain('aarch64-apple-darwin')
    expect(jobJson).toContain('bundle --')
    expect(jobJson).toContain('--updater-endpoint')
    expect(jobJson).toContain('macos-sign-release.mjs')
    expect(jobJson).toContain('DSH_MACOS_APPLE_ID')
    expect(jobJson).toContain('release-artifacts.mjs')
    expect(jobJson).toContain('updater-manifest.mjs')
    expect(jobJson).toContain('update-smoke')
    expect(jobJson).toContain('--manifest')
    expect(jobJson).toContain('--terminal-smoke')
    expect(jobJson).toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(jobJson).toContain('security delete-keychain')
    expect(Array.isArray(job.steps) && job.steps.some(step => isRecord(step) && step.if === 'always()')).toBe(true)
    expect(jobJson).toContain('actions/upload-artifact@v4')
    expect(workflowJson).not.toContain('gh release')
    expect(workflowJson).not.toContain('windows-latest')
    expect(workflowJson).not.toContain('ubuntu-24.04')
  })
})

function loadWorkflow(): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/desktop-macos-update-acceptance.yml'), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError('desktop macOS update workflow must define a workflow')
  return workflow
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

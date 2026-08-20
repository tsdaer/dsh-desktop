import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('desktop release workflow', () => {
  it('builds only an exact version tag and validates it before the installer', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/desktop-release.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.on) || !isRecord(workflow.jobs)) {
      throw new TypeError('desktop release workflow must define events and jobs')
    }

    expect(workflow.on).toEqual({ push: { tags: ['v*'] }, workflow_dispatch: null })

    const validate = workflow.jobs.validate
    const build = workflow.jobs.build
    const draft = workflow.jobs['draft-release']
    if (!isRecord(validate) || !Array.isArray(validate.steps) || !isRecord(build) || !isRecord(draft)) {
      throw new TypeError('desktop release workflow must define validate, build, and draft-release jobs')
    }

    const steps: unknown[] = validate.steps
    const versionStep = steps.find(step => isRecord(step) && step.name === 'Read and verify the desktop version')
    if (!isRecord(versionStep) || typeof versionStep.run !== 'string') {
      throw new TypeError('desktop release validation must define the version step')
    }

    expect(validate['runs-on']).toBe('windows-latest')
    expect(versionStep.shell).toBe('pwsh')
    expect(versionStep.run).toContain("$env:GITHUB_REF_TYPE -ne 'tag'")
    expect(versionStep.run).toContain('$env:GITHUB_REF_NAME -ne $ExpectedTag')
    expect(versionStep.run).toContain('sync-version.mjs --check')
    expect(versionStep.run).toContain('$LASTEXITCODE -ne 0')
    expect(versionStep.run).toContain('changelog-section.mjs')
    expect(build.needs).toBe('validate')
    expect(draft.needs).toEqual(['validate', 'build'])
    expect(JSON.stringify(draft)).not.toContain('steps.version.outputs')
    expect(JSON.stringify(draft)).toContain('needs.validate.outputs.tag')
  })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

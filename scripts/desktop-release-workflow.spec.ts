import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('desktop release workflow', () => {
  it('validates one immutable version tag before target-native builds', () => {
    const workflow = loadWorkflow()
    const validate = requiredJob(workflow, 'validate')
    if (!Array.isArray(validate.steps)) throw new TypeError('desktop release validation must define steps')
    const steps: unknown[] = validate.steps

    expect(workflow.on).toEqual({ push: { tags: ['v*'] }, workflow_dispatch: null })
    expect(validate['runs-on']).toBe('ubuntu-24.04')
    const validation = steps.find(step => isRecord(step) && step.name === 'Read and verify the desktop version')
    if (!isRecord(validation) || typeof validation.run !== 'string') {
      throw new TypeError('desktop release validation must define the version step')
    }
    expect(validation.shell).toBe('bash')
    expect(validation.run).toContain('GITHUB_REF_TYPE')
    expect(validation.run).toContain('GITHUB_REF_NAME')
    expect(validation.run).toContain('sync-version.mjs --check')
    expect(validation.run).toContain('changelog-section.mjs')
    expect(validation.run).toContain('commit=${GITHUB_SHA}')
  })

  it('builds target-native Windows, Linux, and experimental macOS artifacts without sharing runtime bytes', () => {
    const workflow = loadWorkflow()
    const windows = requiredJob(workflow, 'build-windows')
    const linux = requiredJob(workflow, 'build-linux')
    const macos = requiredJob(workflow, 'build-macos-experimental')

    expect(windows['runs-on']).toBe('windows-latest')
    expect(linux['runs-on']).toBe('ubuntu-24.04')
    expect(macos['runs-on']).toBe('macos-14')
    expect(JSON.stringify(windows)).toContain('x86_64-pc-windows-msvc')
    expect(JSON.stringify(linux)).toContain('x86_64-unknown-linux-gnu')
    expect(JSON.stringify(macos)).toContain('aarch64-apple-darwin')
    for (const job of [windows, linux, macos]) {
      const json = JSON.stringify(job)
      expect(json).toContain('pnpm install --frozen-lockfile')
      expect(json).toContain('bundle')
      expect(json).toContain('size-')
      expect(json).not.toContain('.runtime/win32-x64')
      expect(json).not.toContain('actions/download-artifact')
      expect(json).toContain('needs.validate.outputs.commit')
      expect(json).toContain('git rev-parse HEAD')
    }
    expect(JSON.stringify(linux)).toContain('linux-baseline')
    expect(JSON.stringify(linux)).toContain('--output')
    expect(JSON.stringify(linux)).toContain('Upload Linux baseline evidence')
    expect(JSON.stringify(linux)).toContain('packaged-smoke')
    expect(JSON.stringify(linux)).toContain('--terminal-smoke')
    expect(JSON.stringify(linux)).toContain('--install-deb')
    expect(JSON.stringify(linux)).toContain('webkit2gtk-driver')
    expect(JSON.stringify(linux)).toContain('cargo install tauri-driver --locked')
    expect(JSON.stringify(linux)).toContain('native-ui-smoke')
    expect(JSON.stringify(linux)).toContain('Upload Linux native Tauri UI evidence')
    expect(JSON.stringify(linux)).toContain(
      'pnpm --filter @deepseek-ai/dsh-web-frontend exec playwright install --with-deps chromium',
    )
    expect(JSON.stringify(linux)).toContain('apps/web/tests/navigation-panes.e2e.ts')
    expect(JSON.stringify(linux)).toContain('DSH_SNAPSHOT=replay')
    expect(JSON.stringify(linux)).toContain('Upload Linux terminal UI replay evidence')
    expect(JSON.stringify(windows)).toContain('packaged-smoke')
    expect(JSON.stringify(windows)).toContain('--install-nsis')
    expect(JSON.stringify(windows)).toContain('--terminal-smoke')
    expect(JSON.stringify(macos)).toContain('--experimental')
    expect(JSON.stringify(macos)).toContain('--install-dmg')
    expect(JSON.stringify(macos)).toContain('--terminal-smoke')
  })

  it('checks out the validated commit for every release job that reads the source tree', () => {
    const workflow = loadWorkflow()
    for (const name of ['build-windows', 'build-linux', 'build-macos-experimental', 'build-macos-signed', 'draft-release', 'attach-macos-signed', 'attach-macos-experimental']) {
      const job = requiredJob(workflow, name)
      const steps: readonly unknown[] = Array.isArray(job.steps) ? job.steps : []
      const checkout = steps.find((step): step is Record<string, unknown> => isRecord(step) && step.uses === 'actions/checkout@v4')
      if (!isRecord(checkout) || !isRecord(checkout.with)) {
        throw new TypeError(`${name} must checkout the validated source`)
      }
      expect(checkout.with.ref).toBe('${{ needs.validate.outputs.commit }}')
    }
  })

  it('publishes the validated Windows/Linux inventory and separate experimental macOS assets', () => {
    const workflow = loadWorkflow()
    const draft = requiredJob(workflow, 'draft-release')
    const signed = requiredJob(workflow, 'build-macos-signed')
    const attach = requiredJob(workflow, 'attach-macos-signed')
    const experimentalAttach = requiredJob(workflow, 'attach-macos-experimental')

    expect(draft.needs).toEqual(['validate', 'build-windows', 'build-linux'])
    expect(JSON.stringify(draft)).toContain('release-artifacts.mjs verify')
    expect(JSON.stringify(draft)).toContain('sha256sum')
    expect(JSON.stringify(draft)).toContain('updater-manifest.mjs')
    expect(JSON.stringify(draft)).toContain('--draft')
    expect(JSON.stringify(draft)).toContain("steps.check.outputs.is_draft == 'true'")
    expect(JSON.stringify(draft)).not.toContain("steps.check.outputs.is_draft == 'false'")
    expect(JSON.stringify(draft)).not.toContain('build-macos-experimental')

    expect(signed.if).toBe("vars.DSH_DESKTOP_MACOS_RELEASE == 'true'")
    expect(JSON.stringify(signed)).toContain('security create-keychain')
    expect(JSON.stringify(signed)).toContain('security delete-keychain')
    expect(JSON.stringify(signed)).toContain('always()')
    expect(attach.if).toContain("needs.build-macos-signed.result == 'success'")
    expect(JSON.stringify(attach)).toContain('updater-manifest.mjs')
    expect(experimentalAttach.needs).toEqual(['validate', 'draft-release', 'build-macos-experimental'])
    expect(experimentalAttach.if).toContain("needs.build-macos-experimental.result == 'success'")
    expect(JSON.stringify(experimentalAttach)).toContain('dsh-desktop-macos-arm64-experimental')
    expect(JSON.stringify(experimentalAttach)).toContain('tar -czf')
    expect(JSON.stringify(experimentalAttach)).toContain('gh release upload')
    expect(JSON.stringify(experimentalAttach)).not.toContain('updater-manifest.mjs')
  })
})

function loadWorkflow(): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/desktop-release.yml'), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError('desktop release workflow must define a workflow')
  return workflow
}

function requiredJob(workflow: Record<string, unknown>, name: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[name])) {
    throw new TypeError(`desktop release workflow must define ${name}`)
  }
  return workflow.jobs[name]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

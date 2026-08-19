// Build the static Tauri updater manifest from the signed NSIS artifact.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const [version, tag, distArg = 'dist'] = process.argv.slice(2)
if (!version || !tag) {
  console.error('usage: node updater-manifest.mjs <version> <tag> [dist]')
  process.exit(1)
}

const dist = resolve(distArg)
const files = await readdir(dist)
const installers = files.filter((file) => file.toLowerCase().endsWith('.exe'))
if (installers.length !== 1) throw new Error(`expected one NSIS installer in ${dist}, found ${installers.length}`)
const installer = installers[0]
const signatureName = `${installer}.sig`
if (!files.includes(signatureName)) throw new Error(`missing updater signature ${signatureName}`)
const signature = (await readFile(join(dist, signatureName), 'utf8')).trim()
if (signature.length === 0) throw new Error(`updater signature ${signatureName} is empty`)

const repo = 'tsdaer/dsh-desktop'
const manifest = {
  version,
  notes: `dsh-desktop v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64-nsis': {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(basename(installer))}`,
    },
  },
}
await writeFile(resolve('latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[updater-manifest] wrote latest.json for ${version} from ${installer}`)

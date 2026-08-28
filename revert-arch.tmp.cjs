
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const files = cp.execSync('git ls-files *.zh.md').toString().trim().split(/\r?\n/).filter(Boolean)
let fixed = 0
for (const f of files) {
  let s
  try { s = fs.readFileSync(f, 'utf8') } catch (e) { continue }
  const re = /\(([^()]+)\.zh\.md(#[^()]*)?\)/g
  let changed = false
  s = s.replace(re, (m, target, hash) => {
    if (!target.includes('/archived/')) return m
    const enTarget = target.replace(/\.zh\.md$/, '.md')
    const resolved = path.resolve(path.dirname(f), enTarget)
    if (fs.existsSync(resolved)) { changed = true; return '(' + enTarget + (hash || '') + ')' }
    return m
  })
  if (changed) { fs.writeFileSync(f, s); fixed++ }
}
console.log('archived-link reverted files:', fixed)

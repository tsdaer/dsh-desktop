
const fs = require('fs')
const cp = require('child_process')
const files = cp.execSync('git ls-files *.zh.md').toString().trim().split(/\r?\n/).filter(Boolean)
let hits = []
for (const f of files) {
  let cur, fork
  try { cur = fs.readFileSync(f, 'utf8') } catch (e) { continue }
  try { fork = cp.execSync('git show feat/tauri-shell-pre-upstream-merge:' + f, { encoding: 'utf8' }) } catch (e) { continue }
  const cl = cur.split('\n')
  const fl = fork.split('\n')
  for (let i = 0; i < Math.min(cl.length, 30); i++) {
    if (/^\s*\[[^\]]+\]\([^()]+\.(?:zh\.)?md\)\s*$/.test(cl[i])) {
      const fli = fl[i] || ''
      if (fli.trim().length > cl[i].trim().length + 15) {
        hits.push(f + ':' + (i + 1))
      }
    }
  }
}
console.log('truncation hits:', hits.length)
hits.slice(0, 30).forEach(h => console.log(h))


const fs = require('fs')
const cp = require('child_process')
const files = cp.execSync('git ls-files *.zh.md').toString().trim().split(/\r?\n/).filter(Boolean)
let truncated = []
for (const f of files) {
  let cur, up
  try { cur = fs.readFileSync(f, 'utf8') } catch (e) { continue }
  try { up = cp.execSync('git show upstream/master:' + f, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }) } catch (e) { continue }
  const curLines = cur.split('\n')
  const upLines = up.split('\n')
  for (let i = 0; i < Math.min(20, curLines.length); i++) {
    // current line is a bare [text](X.md) with nothing after
    if (/^\s*\[[^\]]+\]\([^()]+\.zh\.md\)\s*$/.test(curLines[i])) {
      // upstream line has more than the link
      const upLine = upLines[i] || ''
      if (upLine.trim().length > curLines[i].trim().length + 10) {
        truncated.push(f + ':' + (i + 1))
        break
      }
    }
  }
}
console.log('truncated candidates:', truncated.length)
truncated.slice(0, 20).forEach(t => console.log(t))

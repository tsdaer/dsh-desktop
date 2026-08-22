// Reports the packaged dsh-desktop runtime payload size and asserts the size
// budget. The gate catches regressions where a FULL (non-prod) deploy or a new
// dev dependency re-leaks the build/lint/docs toolchain into resources/runtime.
//
// Usage:
//   node apps/desktop/scripts/size-report.mjs           # print a report
//   node apps/desktop/scripts/size-report.mjs --check   # fail (exit 1) on budget/leak violation
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTargetFromArgs } from './target-spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolveTargetFromArgs(process.argv.slice(2));
const runtimeDir = resolve(here, '..', target.runtimeRelativeDir);
const artifactDirs = target.artifactDirectories.map((dir) => resolve(here, '..', dir));

// Runtime payload budget in MiB. The target specification owns the baseline so
// each platform reports against its own recorded allowance.
const BUDGET_MB = Number(process.env.DSH_RUNTIME_BUDGET_MB ?? target.sizeBudgetMiB);

// Top-level dev/build/lint/docs packages that must never reach the runtime.
// Every name here was verified absent after the --prod deploy.
const FORBIDDEN = [
  'mermaid', 'typescript', 'oxlint', 'eslint', 'lefthook', 'tsx', 'rolldown',
  'esbuild', 'vitest', 'jsdom', 'jscpd', 'knip', 'publint', '@yarnpkg',
];

/** Sum the size of every regular file under a directory, in MiB. */
function dirSizeMiB(dir) {
  let bytes = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) {
        try { bytes += statSync(path).size; } catch { /* file removed mid-walk */ }
      }
    }
  }
  return bytes / (1024 * 1024);
}

/** Top-level directory names under a directory (real dirs only). */
function topLevelDirs(dir) {
  const names = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return names; }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) names.push(entry.name);
  }
  return names;
}

function main() {
  const check = process.argv.includes('--check');
  if (!existsSync(runtimeDir)) {
    console.error('[size-report] runtime not baked at ' + runtimeDir + '\n  run: node apps/desktop/scripts/bake-runtime.mjs');
    process.exit(check ? 1 : 0);
  }

  const nm = join(runtimeDir, 'node_modules');
  const total = dirSizeMiB(runtimeDir);
  const present = new Set(topLevelDirs(nm));
  const leaked = FORBIDDEN.filter((name) => present.has(name));
  const dirs = [...present]
    .map((name) => ({ name, mb: dirSizeMiB(join(nm, name)) }))
    .sort((a, b) => b.mb - a.mb);

  console.log(`runtime total: ${total.toFixed(1)} MB  (dir ${runtimeDir})`);
  console.log('');
  console.log('top node_modules dirs:');
  for (const d of dirs.slice(0, 20)) {
    console.log(`  ${d.mb.toFixed(1).padStart(8)} MB  ${d.name}`);
  }

  for (const artifactDir of artifactDirs) {
    if (existsSync(artifactDir)) {
      for (const name of readdirSync(artifactDir)) {
        const path = join(artifactDir, name);
        if (statSync(path).isFile()) {
          const mb = statSync(path).size / (1024 * 1024);
          console.log(`\n${target.productTarget} artifact: ${mb.toFixed(1)} MB  (${name})`);
        }
      }
    }
  }

  const problems = [];
  if (leaked.length > 0) problems.push('dev toolchain leaked into runtime: ' + leaked.join(', '));
  if (total > BUDGET_MB) problems.push(`runtime ${total.toFixed(1)} MB exceeds budget ${BUDGET_MB} MB`);

  console.log('');
  if (problems.length > 0) {
    console.error('[size-report] FAIL');
    for (const problem of problems) console.error('  - ' + problem);
    process.exit(1);
  }
  console.log(`[size-report] ok (budget ${BUDGET_MB} MB, no dev-tool leakage)`);
}

main();

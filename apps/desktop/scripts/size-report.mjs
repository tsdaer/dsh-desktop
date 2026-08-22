// Reports the target runtime payload and the artifacts produced by its
// target-specific Tauri build. Runtime and installer bytes are kept separate:
// AppImage, deb, NSIS, and dmg compression is not comparable.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { artifactDirectoriesFor, resolveTargetFromArgs } from './target-spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = [
  'mermaid', 'typescript', 'oxlint', 'eslint', 'lefthook', 'tsx', 'rolldown',
  'esbuild', 'vitest', 'jsdom', 'jscpd', 'knip', 'publint', '@yarnpkg',
];

/** Sum the size of every regular file under a directory, in MiB. */
export function dirSizeMiB(dir) {
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

function topLevelDirs(dir) {
  const names = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return names; }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) names.push(entry.name);
  }
  return names;
}

function walkArtifactEntries(dir, entries) {
  let children;
  try { children = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of children) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    entries.push({ path, name: entry.name, directory: entry.isDirectory() });
    if (entry.isDirectory()) walkArtifactEntries(path, entries);
  }
}

/**
 * Inspect the expected output directories and artifact suffixes for one
 * target. The result is pure inventory data suitable for a release gate.
 *
 * @param {Readonly<{artifactDirectories: readonly string[], rustTriple: string, updaterArtifactSuffixes: readonly string[]}>} target
 * @param {string} desktopRoot
 * @returns {{directories: string[], entries: Array<{path: string, name: string, directory: boolean}>, missing: string[], compressedBytes: number}}
 */
export function inspectArtifacts(target, desktopRoot) {
  const directories = artifactDirectoriesFor(target, desktopRoot);
  const entries = [];
  for (const directory of directories) walkArtifactEntries(directory, entries);
  const missing = target.updaterArtifactSuffixes.filter((suffix) =>
    !entries.some((entry) => entry.name.endsWith(suffix)),
  );
  const compressedBytes = entries
    .filter((entry) => !entry.directory && !entry.name.endsWith('.sig') &&
      target.updaterArtifactSuffixes.some((suffix) => suffix !== '.app' && !suffix.endsWith('.sig') && entry.name.endsWith(suffix)))
    .reduce((total, entry) => total + statSync(entry.path).size, 0);
  return { directories, entries, missing, compressedBytes };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const target = resolveTargetFromArgs(args);
  const runtimeDir = resolve(here, '..', target.runtimeRelativeDir);
  const artifactInfo = inspectArtifacts(target, resolve(here, '..'));
  const budgetMiB = Number(process.env.DSH_RUNTIME_BUDGET_MB ?? target.sizeBudgetMiB);

  if (!existsSync(runtimeDir)) {
    console.error('[size-report] runtime not baked at ' + runtimeDir + '\n  run: node apps/desktop/scripts/bake-runtime.mjs --target ' + target.rustTriple);
    process.exit(check ? 1 : 0);
  }

  const nm = join(runtimeDir, 'node_modules');
  const totalMiB = dirSizeMiB(runtimeDir);
  const present = new Set(topLevelDirs(nm));
  const leaked = FORBIDDEN.filter((name) => present.has(name));
  const dirs = [...present]
    .map((name) => ({ name, mb: dirSizeMiB(join(nm, name)) }))
    .sort((a, b) => b.mb - a.mb);

  console.log(`runtime total: ${totalMiB.toFixed(1)} MB  (dir ${runtimeDir})`);
  console.log(`compressed installer bytes: ${(artifactInfo.compressedBytes / (1024 * 1024)).toFixed(1)} MB`);
  console.log('');
  console.log('top node_modules dirs:');
  for (const d of dirs.slice(0, 20)) console.log(`  ${d.mb.toFixed(1).padStart(8)} MB  ${d.name}`);
  for (const directory of artifactInfo.directories) console.log(`artifact directory: ${directory}`);
  for (const entry of artifactInfo.entries.filter((entry) => !entry.directory)) {
    const mb = statSync(entry.path).size / (1024 * 1024);
    console.log(`artifact: ${mb.toFixed(1)} MB  (${entry.name})`);
  }

  const problems = [];
  if (leaked.length > 0) problems.push('dev toolchain leaked into runtime: ' + leaked.join(', '));
  if (totalMiB > budgetMiB) problems.push(`runtime ${totalMiB.toFixed(1)} MB exceeds budget ${budgetMiB} MB`);
  if (artifactInfo.missing.length > 0) problems.push('missing expected artifacts: ' + artifactInfo.missing.join(', '));

  console.log('');
  if (problems.length > 0) {
    console.error('[size-report] FAIL');
    for (const problem of problems) console.error('  - ' + problem);
    process.exit(1);
  }
  console.log(`[size-report] ok (target ${target.productTarget}, budget ${budgetMiB} MB, artifacts complete)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

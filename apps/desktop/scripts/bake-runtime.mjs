// Produces a self-contained, bootable offline runtime directory for the
// dsh-desktop shell, from the built workspace.
//
// The runtime is the dsh CLI closure run by a bundled Node: it must carry the
// web profile's plugins, the web frontend dist, and native addons (node-pty,
// koffi) with no path back into the checkout. The recipe:
//
//   1. `pnpm deploy --legacy --prod` the CLI closure. Production-only deploy
//      drops the workspace's dev/build/lint/docs toolchain (TypeScript, oxlint,
//      eslint, mermaid, ...) that a FULL deploy leaked into the runtime; the
//      spine packages stay reachable through dsh-base's dependencies, and the
//      scan/bake loop below restores auto-installed peers and any
//      config-referenced plugin that --prod prunes.
//   2. Bake missing `@deepseek-ai/*` packages: `pnpm deploy` does not install
//      auto-installed peers (the workspace relies on autoInstallPeers; the
//      deployed tree does not reproduce them). The static scan below walks the
//      deployed tree, resolves every bare @deepseek-ai import the way Node
//      would, and copies the missing packages from their workspace source.
//   3. Prune single-platform native prebuilds (node-pty ships every platform
//      plus debug symbols and build-time sources): keep the selected target's
//      prebuild or a target source build, and remove foreign native bytes.
//   4. Boot-verify: run the deployed CLI against a throwaway DSH_HOME and
//      require the `dsh web:` readiness line.
//
// The resulting directory is the Tauri `resources` payload; the shell spawns
// `<runtime>/lib/bin.js` with the bundled Node. See apps/desktop/README.md.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pruneNativeRuntime, validateNativeRuntime } from './runtime-native.mjs';
import { resolveTargetFromArgs } from './target-spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const cliBin = resolve(repoRoot, 'apps/cli/lib/bin.js');
const webDist = resolve(repoRoot, 'apps/web/dist/index.html');

/// Dev toolchain packages that must never ship in the runtime. pnpm deploy
/// --prod can leak them when a workspace package declares them as regular
/// dependencies (typert-generator depends on typescript); the runtime never
/// executes them, so strip them after baking to keep the payload clean and
/// the size gate green.
const FORBIDDEN_PACKAGES = [
  'typescript', 'mermaid', 'oxlint', 'eslint', 'lefthook', 'tsx', 'rolldown',
  'esbuild', 'vitest', 'jsdom', 'jscpd', 'knip', 'publint', '@yarnpkg',
];

const args = process.argv.slice(2);
const target = resolveTargetFromArgs(args);
const defaultDeployDir = resolve(here, '..', target.runtimeRelativeDir);
// Resolve once against the repository, never against the ambient cwd: a
// relative --dir would otherwise plant a deploy tree wherever the command
// happened to run from, and `pnpm deploy` creates every missing parent.
const deployDirArg = flag(args, '--dir');
const deployDir = deployDirArg === undefined ? defaultDeployDir : resolve(repoRoot, deployDirArg);
const skipDeploy = args.includes('--no-deploy');
const maxBakeRounds = 10;

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// Prerequisites mirror apps/desktop/scripts/dev.mjs.
if (!existsSync(cliBin)) {
  fail('dsh CLI not built: expected ' + cliBin + '\n  run at the repo root: pnpm run build:lib');
}
if (!existsSync(webDist)) {
  fail('web frontend not built: expected ' + webDist + '\n  run at the repo root: pnpm run build:web');
}

async function main() {
  if (args.includes('--bake')) {
    // Bake one or more named packages from their workspace source, then exit.
    const sources = workspaceSources();
    const names = args.slice(args.indexOf('--bake') + 1).filter((a) => !a.startsWith('--'));
    for (const name of names) {
      bakePackage(deployDir, name, sources.get(name));
    }
    return;
  }

  if (args.includes('--scan')) {
    for (const name of scanMissing(deployDir)) console.log(name);
    return;
  }

  if (args.includes('--boot')) {
    await verifyBoot(deployDir);
    return;
  }

  if (!skipDeploy) {
    console.log('[bake-runtime] deploying CLI closure (prod, legacy) into ' + deployDir);
    rmSync(deployDir, { recursive: true, force: true });
    mkdirSync(dirname(deployDir), { recursive: true });
    const r = spawnSync('corepack', ['pnpm', 'deploy', '--filter', '@deepseek-ai/dsh', '--prod', '--legacy', '--config.nodeLinker=hoisted', deployDir], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
      fail('pnpm deploy failed: ' + (r.stderr || r.stdout));
    }
  }

  const missing = scanMissing(deployDir);
  // The desktop bridge packages are host-specific workspace packages the CLI
  // closure never references; the shell copies them from the runtime into the
  // profile at first boot (no npm at runtime), so they must travel here.
  for (const name of ['@deepseek-ai/dsh-desktop-bridge', '@deepseek-ai/dsh-desktop-bridge-client']) missing.add(name);
  const sources = workspaceSources();
  for (let round = 0; round < maxBakeRounds && missing.size > 0; round++) {
    console.log(`[bake-runtime] round ${round + 1}: baking ${missing.size} missing package(s)`);
    for (const name of missing) {
      bakePackage(deployDir, name, sources.get(name));
    }
    missing.clear();
    for (const name of scanMissing(deployDir)) missing.add(name);
  }
  if (missing.size > 0) {
    fail('runtime still missing packages after ' + maxBakeRounds + ' rounds: ' + [...missing].join(', '));
  }
  resolveSymlinkedPackages(deployDir, sources);
  removeForbiddenPackages(deployDir);

  // The desktop bridge packages are produced by scripts/build-bridge.mjs
  // (they are not workspace members, so the repo build never rebuilds them);
  // bakePackage skips missing files entries silently, so a missing lib would
  // otherwise ship a bridge that cannot load. Fail loud instead.
  for (const entry of [
    '@deepseek-ai/dsh-desktop-bridge/lib/index.js',
    '@deepseek-ai/dsh-desktop-bridge-client/lib/index.js',
  ]) {
    if (!existsSync(join(deployDir, 'node_modules', entry))) {
      fail('runtime missing ' + entry + '; run pnpm --filter @deepseek-ai/dsh-desktop build:bridge before baking');
    }
  }

  pruneRuntime(deployDir);
  try {
    validateNativeRuntime(deployDir, target);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  await verifyBoot(deployDir);
  console.log('[bake-runtime] runtime ready at ' + deployDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// --- completeness scan ----------------------------------------------------

/// Walk the deployed tree, collect every `@deepseek-ai/<pkg>` bare specifier,
/// and return the names that do not resolve from every file importing them.
/// Symlinked directories are skipped: the .pnpm store holds real copies of the
/// package files, and baked packages are real copies too.
function scanMissing(root) {
  const importedBy = new Map(); // package name -> [file, ...]
  walkFiles(root, (file) => {
    if (!/\.(?:js|mjs|cjs)$/.test(file)) return;
    const text = readFileSafe(file);
    if (text === undefined) return;
    const matches = text.matchAll(/from\s*['"](@deepseek-ai\/[^'"]+)['"]|import\s*['"](@deepseek-ai\/[^'"]+)['"]|import\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)|require\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)/g);
    for (const m of matches) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      const name = spec.split('/').slice(0, 2).join('/');
      if (!importedBy.has(name)) importedBy.set(name, []);
      importedBy.get(name).push(file);
    }
  });
  const missing = new Set();
  for (const [name, files] of importedBy) {
    for (const file of files) {
      if (!resolveBare(root, file, name)) {
        missing.add(name);
        break;
      }
    }
  }
  return missing;
}

/// Node-style upward resolution for a bare `@deepseek-ai/<pkg>` specifier,
/// starting at the importing file's directory.
function resolveBare(root, file, name) {
  let dir = dirname(file);
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return true;
    if (dir === root || dir === dirname(dir)) return false;
    dir = dirname(dir);
  }
}

/// Copy the shipped files of a workspace package into the deploy tree as a
/// real copy. Only package.json and the `files` entries travel; node_modules
/// never does (the source tree's nested node_modules are workspace junctions
/// that cannot resolve outside the checkout).
function bakePackage(root, name, sourceDir) {
  if (!sourceDir) {
    console.warn(`[bake-runtime] no workspace source for ${name}; leaving it for boot to report`);
    return;
  }
  const target = join(root, 'node_modules', name);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : ['lib'];
  writeFileSync(join(target, 'package.json'), readFileSync(join(sourceDir, 'package.json')));
  for (const entry of files) {
    const from = resolve(sourceDir, entry);
    if (!existsSync(from)) continue;
    copyRecursive(from, join(target, entry));
  }
  console.log('[bake-runtime] baked ' + name + ' from ' + relative(repoRoot, sourceDir));
}

/// Replace symlinked @deepseek-ai packages with real workspace copies. pnpm
/// deploy with nodeLinker=hoisted leaves some packages as symlinks back into
/// the checkout; the Tauri resources payload does not follow symlinks, so an
/// installed runtime would carry a dangling link (e.g. schemastery) and fail
/// module resolution at boot. Bake every symlinked package into a real copy.
function resolveSymlinkedPackages(root, sources) {
  const packagesRoot = join(root, 'node_modules', '@deepseek-ai');
  if (!existsSync(packagesRoot)) return;
  for (const name of readdirSafe(packagesRoot)) {
    const full = join(packagesRoot, name);
    let isLink = false;
    try { isLink = lstatSync(full).isSymbolicLink(); } catch { continue; }
    if (!isLink) continue;
    const pkgName = '@deepseek-ai/' + name;
    const sourceDir = sources.get(pkgName);
    if (sourceDir === undefined) {
      console.warn('[bake-runtime] no workspace source for symlinked ' + pkgName + '; leaving the link');
      continue;
    }
    bakePackage(root, pkgName, sourceDir);
  }
}

/// Dev toolchain packages that must never ship in the runtime. pnpm deploy
/// --prod can leak them when a workspace package declares them as regular
/// dependencies (typert-generator depends on typescript); the runtime never
/// executes them, so strip them after baking to keep the payload clean and
/// the size gate green.
function removeForbiddenPackages(root) {
  for (const name of FORBIDDEN_PACKAGES) {
    rmSync(join(root, 'node_modules', name), { recursive: true, force: true });
  }
}

/// Map every workspace package name to its source directory.
/// Layout: packages/<group>/<pkg>, vendor/<pkg>, apps/<pkg>, native/<pkg>/packages/<pkg>.
function workspaceSources() {
  const map = new Map();
  const roots = [
    join(repoRoot, 'packages'),
    join(repoRoot, 'vendor'),
    join(repoRoot, 'apps'),
    join(repoRoot, 'native/landlock-run/packages'),
  ];
  const candidates = [];
  for (const root of roots) {
    for (const dir of readdirSafe(root)) {
      const first = join(root, dir);
      if (!statSync(first).isDirectory()) continue;
      candidates.push(first);
      for (const sub of readdirSafe(first)) {
        candidates.push(join(first, sub));
      }
    }
  }
  for (const pkgDir of candidates) {
    const manifestPath = join(pkgDir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSafe(manifestPath) ?? '{}');
    if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) {
      map.set(manifest.name, pkgDir);
    }
  }
  return map;
}

/// Boot the deployed CLI against a throwaway profile and require the readiness
/// line. Built-in packages resolve through the profile fallback that points at
/// the deployed tree, while a real profile may still resolve its own bundles.
/// Each failed attempt names missing runtime packages in stderr, and the loop
/// bakes them until the tree settles.
async function verifyBoot(root) {
  const home = mkdtempSync(join(process.env.TEMP ?? '/tmp', 'dsh-bake-'));
  const sources = workspaceSources();
  const sidecar = resolve(here, '..', 'src-tauri', 'binaries', target.sidecarBasename);
  if (!existsSync(sidecar)) {
    fail('target Node sidecar not fetched: expected ' + sidecar + '\n  run: node apps/desktop/scripts/fetch-node-sidecar.mjs --target ' + target.rustTriple);
  }
  try {
    // The profile fallback links built-in packages into the deployed tree;
    // leaving the module base unset also preserves profile-owned bundles.
    const bootEnv = { ...process.env, DSH_HOME: home };
    // First boot: initialize the web profile template (same trick main.rs uses).
    const init = spawnSync(sidecar, [join(root, 'lib/bin.js'), '--profile', 'web', '--dump-default-config'], {
      env: bootEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (init.status !== 0) {
      fail('profile init failed: ' + (init.stderr || init.stdout));
    }
    for (let attempt = 1; attempt <= maxBakeRounds; attempt++) {
      const { ok, line, stderr } = await attemptBoot(root, bootEnv, sidecar);
      if (ok) {
        console.log('[bake-runtime] boot verified at ' + line);
        return;
      }
      const missing = missingFromStderr(stderr);
      if (missing.size === 0) {
        fail('runtime boot failed with no missing package to bake.\n' + (stderr.slice(0, 4000) || '(no stderr)'));
      }
      console.log(`[bake-runtime] boot round ${attempt}: baking ${missing.size} loader-referenced package(s)`);
      for (const name of missing) {
        bakePackage(root, name, sources.get(name));
      }
    }
    fail('runtime boot did not settle after ' + maxBakeRounds + ' bake rounds');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/// Run one boot attempt; return the readiness line (or empty) and stderr.
function attemptBoot(root, bootEnv, sidecar) {
  return new Promise((finish) => {
    const child = spawn(sidecar, [join(root, 'lib/bin.js'), '--profile', 'web', '--port', '0'], {
      env: bootEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let settled = false;
    const complete = (result) => {
      if (settled) return;
      settled = true;
      finish(result);
    };
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const deadline = Date.now() + 90_000;
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        terminateProcessTree(child);
        complete({ ok: false, line: '', stderr });
      }
    }, 500);
    child.stdout.on('data', (chunk) => {
      const match = ('' + chunk).match(/dsh web: (https?:\/\/[^\s\r\n]+)/);
      if (match) {
        clearInterval(timer);
        terminateProcessTree(child);
        complete({ ok: true, line: match[1], stderr });
      }
    });
    child.on('error', (error) => {
      clearInterval(timer);
      stderr += `\n${error.message}`;
      complete({ ok: false, line: '', stderr });
    });
    child.on('exit', () => {
      clearInterval(timer);
      complete({ ok: false, line: '', stderr });
    });
  });
}

function terminateProcessTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

/// Strip non-target prebuilds, build-time sources, and Windows debug symbols
/// from native packages that ship them all. Run before boot-verify so the boot
/// proves the pruned tree still resolves its native addons.
function pruneRuntime(root) {
  pruneNativeRuntime(root, target);
  const nodePty = join(root, 'node_modules', 'node-pty');
  if (existsSync(nodePty)) {
    const prebuilds = join(nodePty, 'prebuilds');
    if (existsSync(prebuilds)) {
      for (const entry of readdirSafe(prebuilds)) {
        if (entry !== target.nativePlatformKey) rmSync(join(prebuilds, entry), { recursive: true, force: true });
      }
    }
    // Build-time-only content: the C++ sources, winpty vendored sources, and
    // the local `build/` output are never read by lib/index.js at runtime.
    for (const dir of ['build', 'third_party', 'deps', 'src', 'scripts']) {
      rmSync(join(nodePty, dir), { recursive: true, force: true });
    }
    rmSync(join(nodePty, 'binding.gyp'), { force: true });
    // Windows PDBs are debug symbols; the runtime never loads them.
    walkFiles(nodePty, (file) => {
      if (file.endsWith('.pdb')) rmSync(file, { force: true });
    });
    console.log('[bake-runtime] pruned node-pty to ' + target.nativePlatformKey + ' prebuild');
  }
}

/// Collect the `Cannot find package 'X'` names a failed boot reported.
function missingFromStderr(stderr) {
  const missing = new Set();
  const re = /Cannot find package '([^']+)' imported from/g;
  let m;
  while ((m = re.exec(stderr)) !== null) {
    if (m[1].startsWith('@deepseek-ai/')) missing.add(m[1]);
  }
  return missing;
}

// --- small fs helpers ------------------------------------------------------

function walkFiles(root, visit) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // do not follow junctions out of the deploy
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) visit(full);
    }
  }
}

function copyRecursive(from, to) {
  const st = statSync(from);
  if (st.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSafe(from)) {
      copyRecursive(join(from, entry), join(to, entry));
    }
  } else if (st.isFile()) {
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(from));
  }
}

function readdirSafe(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function readFileSafe(file) {
  try { return readFileSync(file, 'utf8'); } catch { return undefined; }
}

function fail(message) {
  console.error('[bake-runtime] ' + message);
  process.exit(1);
}

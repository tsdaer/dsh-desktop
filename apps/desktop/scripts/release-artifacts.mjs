import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { artifactDirectoriesFor, resolveTargetFromArgs, SUPPORTED_TARGETS } from './target-spec.mjs';

function directEntries(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      path: join(directory, entry.name),
      directory: entry.isDirectory(),
    }));
}

/**
 * Return the direct bundle outputs for a target and reject unowned files.
 *
 * @param {Readonly<{artifactDirectories: readonly string[], productTarget: string, rustTriple: string, updaterArtifactSuffixes: readonly string[]}>} target
 * @param {string} desktopRoot
 * @returns {Array<{name: string, path: string, directory: boolean}>}
 */
export function collectReleaseArtifacts(target, desktopRoot) {
  const entries = artifactDirectoriesFor(target, desktopRoot).flatMap(directEntries);
  const unexpected = entries.filter((entry) => !target.updaterArtifactSuffixes.some((suffix) => entry.name.endsWith(suffix)));
  if (unexpected.length > 0) {
    throw new Error(`unexpected ${target.productTarget} release artifact: ${unexpected.map((entry) => entry.name).join(', ')}`);
  }
  const missing = target.updaterArtifactSuffixes.filter((suffix) => !entries.some((entry) => entry.name.endsWith(suffix)));
  if (missing.length > 0) {
    throw new Error(`missing ${target.productTarget} release artifact suffix: ${missing.join(', ')}`);
  }
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`duplicate ${target.productTarget} release artifact: ${entry.name}`);
    names.add(entry.name);
    if (!entry.directory && statSync(entry.path).size === 0) throw new Error(`empty ${target.productTarget} release artifact: ${entry.name}`);
  }
  return entries;
}

/**
 * Stage one target's verified direct bundle outputs under a stable product-target directory.
 *
 * @param {Readonly<{artifactDirectories: readonly string[], productTarget: string, rustTriple: string, updaterArtifactSuffixes: readonly string[]}>} target
 * @param {string} desktopRoot
 * @param {string} outputRoot
 * @returns {string}
 */
export function stageReleaseArtifacts(target, desktopRoot, outputRoot) {
  const entries = collectReleaseArtifacts(target, desktopRoot);
  const targetRoot = resolve(outputRoot, target.productTarget);
  if (existsSync(targetRoot) && readdirSync(targetRoot).length > 0) {
    throw new Error(`release artifact staging directory is not empty: ${targetRoot}`);
  }
  mkdirSync(targetRoot, { recursive: true });
  for (const entry of entries) cpSync(entry.path, join(targetRoot, entry.name), { recursive: true, errorOnExist: true });
  return targetRoot;
}

/**
 * Validate a staged release inventory before publication.
 *
 * @param {{root: string, version: string, targets: readonly Readonly<{productTarget: string, updaterArtifactSuffixes: readonly string[]}>[]}} input
 * @returns {Array<{target: string, name: string, path: string}>}
 */
export function verifyStagedRelease({ root, version, targets }) {
  if (targets.length === 0) throw new Error('staged release contains no supported target directories');
  const inventory = [];
  const names = new Set();
  const knownTargets = new Set(targets.map((target) => target.productTarget));
  for (const entry of directEntries(root)) {
    if (entry.directory && !knownTargets.has(entry.name)) throw new Error(`unexpected staged target directory: ${entry.name}`);
  }
  for (const target of targets) {
    const targetRoot = resolve(root, target.productTarget);
    const entries = directEntries(targetRoot);
    if (entries.length === 0) throw new Error(`missing staged target directory: ${target.productTarget}`);
    for (const entry of entries) {
      if (!target.updaterArtifactSuffixes.some((suffix) => entry.name.endsWith(suffix))) {
        throw new Error(`unexpected staged ${target.productTarget} artifact: ${entry.name}`);
      }
      // Tauri emits the macOS application bundle as an unversioned directory
      // (`dsh-desktop.app`); the signed updater archive and every other
      // release file remain versioned and are checked below.
      if (!entry.directory && !entry.name.includes(version)) {
        throw new Error(`staged artifact ${entry.name} does not contain version ${version}`);
      }
      if (!entry.directory && statSync(entry.path).size === 0) throw new Error(`empty staged artifact: ${entry.name}`);
      if (names.has(entry.name)) throw new Error(`duplicate staged release artifact: ${entry.name}`);
      names.add(entry.name);
      inventory.push({ target: target.productTarget, name: entry.name, path: entry.path });
    }
    for (const suffix of target.updaterArtifactSuffixes) {
      if (!entries.some((entry) => entry.name.endsWith(suffix))) {
        throw new Error(`missing staged ${target.productTarget} artifact suffix: ${suffix}`);
      }
    }
  }
  return inventory;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] === 'verify' ? 'verify' : 'stage';
  const outputIndex = args.indexOf('--output');
  const outputRoot = outputIndex < 0 ? resolve('release-artifacts') : args[outputIndex + 1];
  if (!outputRoot || outputRoot.startsWith('-')) throw new Error('--output requires a directory');
  if (command === 'verify') {
    const versionIndex = args.indexOf('--version');
    const version = versionIndex < 0 ? undefined : args[versionIndex + 1];
    if (!version || version.startsWith('-')) throw new Error('verify requires --version');
    const targets = Object.values(SUPPORTED_TARGETS).filter((candidate) => existsSync(resolve(outputRoot, candidate.productTarget)));
    verifyStagedRelease({ root: outputRoot, version, targets });
    console.log(`[release-artifacts] verified ${targets.map((candidate) => candidate.productTarget).join(', ')}`);
  } else {
    const target = resolveTargetFromArgs(args);
    const staged = stageReleaseArtifacts(target, resolve(import.meta.dirname, '..'), outputRoot);
    console.log(`[release-artifacts] staged ${target.productTarget} at ${staged}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`[release-artifacts] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

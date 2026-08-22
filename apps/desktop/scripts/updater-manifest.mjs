import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SUPPORTED_TARGETS } from './target-spec.mjs';

const repo = 'tsdaer/dsh-desktop';

async function directEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Collect direct bundle outputs for one target. Bundle directories are kept
 * as entries so a macOS `.app` is validated without treating its internals as
 * release assets.
 *
 * @param {Readonly<{artifactDirectories: readonly string[], productTarget: string}>} target
 * @param {string} desktopRoot
 * @returns {Promise<Array<{name: string, path: string, directory: boolean}>>}
 */
async function targetArtifacts(target, desktopRoot) {
  const entries = [];
  const stagedDirectory = resolve(desktopRoot, target.productTarget);
  const stagedEntries = await directEntries(stagedDirectory);
  if (stagedEntries.length > 0) {
    return stagedEntries
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => ({
        name: entry.name,
        path: join(stagedDirectory, entry.name),
        directory: entry.isDirectory(),
      }));
  }
  for (const relative of target.artifactDirectories) {
    const directory = resolve(desktopRoot, relative.replaceAll('{rustTriple}', target.rustTriple));
    for (const entry of await directEntries(directory)) {
      if (entry.isSymbolicLink()) continue;
      entries.push({
        name: entry.name,
        path: join(directory, entry.name),
        directory: entry.isDirectory(),
      });
    }
  }
  if (entries.length === 0 && target.productTarget === 'windows-x64') {
    for (const entry of await directEntries(desktopRoot)) {
      if (entry.isSymbolicLink()) continue;
      entries.push({ name: entry.name, path: join(desktopRoot, entry.name), directory: entry.isDirectory() });
    }
  }
  return entries;
}

/**
 * Build updater rows from the artifacts in the validated release workspace.
 * Each target owns a directory or bundle output set; a Windows flat directory
 * remains accepted for the existing single-target release workflow.
 *
 * @param {{version: string, tag: string, desktopRoot: string, targets?: readonly Readonly<object>[]}} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildUpdaterManifest({ version, tag, desktopRoot, targets = Object.values(SUPPORTED_TARGETS) }) {
  const platforms = {};
  for (const target of targets) {
    const entries = await targetArtifacts(target, desktopRoot);
    const allowed = target.updaterArtifactSuffixes;
    const unexpected = entries.filter((entry) => !allowed.some((suffix) => entry.name.endsWith(suffix)));
    if (unexpected.length > 0) {
      throw new Error(`unexpected ${target.productTarget} artifact: ${unexpected.map((entry) => entry.name).join(', ')}`);
    }
    const artifacts = entries.filter((entry) => entry.name.endsWith(target.updaterArtifactSuffix));
    if (artifacts.length !== 1) {
      throw new Error(`expected one ${target.updaterArtifactSuffix} artifact for ${target.productTarget}, found ${artifacts.length}`);
    }
    const artifact = artifacts[0];
    const signatureName = `${artifact.name.slice(0, -target.updaterArtifactSuffix.length)}${target.updaterSignatureSuffix}`;
    const signature = entries.find((entry) => entry.name === signatureName);
    if (!signature || signature.directory) throw new Error(`missing updater signature ${signatureName}`);
    const signatureText = (await readFile(signature.path, 'utf8')).trim();
    if (signatureText.length === 0) throw new Error(`updater signature ${signatureName} is empty`);
    if (!artifact.name.includes(version)) throw new Error(`artifact ${artifact.name} does not contain version ${version}`);
    const artifactStat = await stat(artifact.path);
    if (!artifact.directory && artifactStat.size === 0) throw new Error(`artifact ${artifact.name} is empty`);
    const release = {
      signature: signatureText,
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(basename(artifact.name))}`,
    };
    platforms[target.updaterPlatform] = release;
  }
  return {
    version,
    notes: `dsh-desktop v${version}`,
    pub_date: new Date().toISOString(),
    platforms,
  };
}

async function main() {
  const [version, tag, distArg = 'dist'] = process.argv.slice(2);
  if (!version || !tag) {
    console.error('usage: node updater-manifest.mjs <version> <tag> [desktop-root]');
    process.exit(1);
  }
  const desktopRoot = resolve(distArg);
  const windows = SUPPORTED_TARGETS['x86_64-pc-windows-msvc'];
  const directFiles = await directEntries(desktopRoot);
  const stagedTargets = Object.values(SUPPORTED_TARGETS).filter((target) =>
    directFiles.some((entry) => entry.isDirectory() && entry.name === target.productTarget),
  );
  const targets = stagedTargets.length > 0
    ? stagedTargets
    : directFiles.some((entry) => entry.name.toLowerCase().endsWith('.exe'))
    ? [windows]
    : Object.values(SUPPORTED_TARGETS);
  const manifest = await buildUpdaterManifest({ version, tag, desktopRoot, targets });
  await writeFile(resolve('latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[updater-manifest] wrote latest.json for ${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[updater-manifest] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

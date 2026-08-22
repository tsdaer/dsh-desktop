import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SUPPORTED_TARGETS } from './target-spec.mjs';

const repo = 'tsdaer/dsh-desktop';
const publicKeyConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const DEFAULT_UPDATER_PUBLIC_KEY = publicKeyConfig?.plugins?.updater?.pubkey;

function decodeBase64(value, label) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`${label} is not valid base64`);
  }
  return Buffer.from(value, 'base64');
}

function decodeMinisignText(value, label) {
  const decoded = decodeBase64(value.trim(), label).toString('utf8');
  const lines = decoded.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ')
    || !lines[2].startsWith('trusted comment: ')) {
    throw new Error(`${label} is not a Tauri Minisign signature`);
  }
  return lines;
}

function decodeMinisignPublicKey(value) {
  const decoded = decodeBase64(value.trim(), 'updater public key').toString('utf8');
  const lines = decoded.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')) {
    throw new Error('updater public key is not a Minisign public key');
  }
  return decodeBase64(lines[1], 'updater public key payload');
}

/**
 * Verify one Tauri updater signature against the public key embedded in the
 * application configuration. Tauri uses Minisign's prehashed Ed25519 form;
 * checking both the file signature and trusted comment signature prevents a
 * staged artifact or its release metadata from being replaced independently.
 *
 * @param {Buffer} artifactBytes Artifact bytes covered by the signature.
 * @param {string} signatureText Tauri `.sig` file contents.
 * @param {string} publicKeyText Base64-encoded Minisign public key.
 * @param {string} artifactName Artifact name used in diagnostics.
 * @returns {void}
 */
export function verifyMinisignSignature(artifactBytes, signatureText, publicKeyText, artifactName) {
  const signatureLines = decodeMinisignText(signatureText, `${artifactName}.sig`);
  const signature = decodeBase64(signatureLines[1], `${artifactName}.sig payload`);
  const publicKey = decodeMinisignPublicKey(publicKeyText);
  if (signature.length !== 74 || publicKey.length !== 42
    || signature.subarray(0, 2).toString() !== 'ED'
    || publicKey.subarray(0, 2).toString() !== 'Ed'
    || !signature.subarray(2, 10).equals(publicKey.subarray(2, 10))) {
    throw new Error(`updater signature key or algorithm mismatch for ${artifactName}`);
  }
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey.subarray(10)]),
    format: 'der',
    type: 'spki',
  });
  const fileDigest = createHash('blake2b512').update(artifactBytes).digest();
  if (!verify(null, fileDigest, key, signature.subarray(10))) {
    throw new Error(`updater signature verification failed for ${artifactName}`);
  }
  const trustedComment = Buffer.from(signatureLines[2].slice('trusted comment: '.length), 'utf8');
  const globalSignature = decodeBase64(signatureLines[3], `${artifactName}.sig trusted signature`);
  if (globalSignature.length !== 64
    || !verify(null, Buffer.concat([signature.subarray(10), trustedComment]), key, globalSignature)) {
    throw new Error(`updater trusted comment verification failed for ${artifactName}`);
  }
}

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
 * @param {{version: string, tag: string, desktopRoot: string, targets?: readonly Readonly<object>[], publicKey?: string}} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildUpdaterManifest({
  version,
  tag,
  desktopRoot,
  targets = Object.values(SUPPORTED_TARGETS),
  publicKey = DEFAULT_UPDATER_PUBLIC_KEY,
}) {
  if (typeof publicKey !== 'string' || publicKey.length === 0) throw new Error('updater public key is missing');
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
    verifyMinisignSignature(await readFile(artifact.path), signatureText, publicKey, artifact.name);
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

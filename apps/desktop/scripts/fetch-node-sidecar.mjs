// Download the official Node distribution for one product target and copy only
// its Node executable into Tauri's externalBin directory. The binary and its
// metadata are gitignored; a cache hit is accepted only after both values and
// the executable's reported version match the requested target.
import { createWriteStream } from 'node:fs';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractionPath,
  nodeDistributionFiles,
  resolveTargetFromArgs,
} from './target-spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const target = resolveTargetFromArgs(args);
const version = process.env.DSH_NODE_VERSION ?? '22.23.1';
const { archiveName, sourceMember } = nodeDistributionFiles(target, version);
const destination = resolve(here, '../src-tauri/binaries', target.sidecarBasename);
const metadataPath = `${destination}.meta.json`;
const archiveUrl = `https://nodejs.org/dist/v${version}/${archiveName}`;

async function download(url, destinationPath) {
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (proxy) {
    new URL(proxy);
    execFileSync('curl', ['--fail', '--location', '--proxy', proxy, '--output', destinationPath, url], {
      stdio: 'inherit',
    });
    return;
  }
  await downloadHttps(url, destinationPath);
}

async function downloadHttps(url, destinationPath) {
  await new Promise((resolveDone, reject) => {
    const request = get(url, (response) => {
      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        downloadHttps(new URL(location, url).toString(), destinationPath).then(resolveDone, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Node archive request failed with HTTP ${response.statusCode}`));
        return;
      }
      const output = createWriteStream(destinationPath, { flags: 'wx' });
      response.pipe(output);
      output.on('finish', () => output.close(resolveDone));
      output.on('error', reject);
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

function extractArchive(archivePath, extractDir) {
  mkdirSync(extractDir, { recursive: true });
  if (target.nodeArchiveKind === 'zip') {
    if (process.platform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
        archivePath,
        extractDir,
      ], { stdio: 'inherit' });
    } else {
      execFileSync('unzip', ['-q', archivePath, '-d', extractDir], { stdio: 'inherit' });
    }
    return;
  }
  const flag = target.nodeArchiveKind === 'tar.xz' ? '-xJf' : '-xzf';
  execFileSync('tar', [flag, archivePath, '-C', extractDir], { stdio: 'inherit' });
}

function cachedSidecarMatches() {
  if (!existsSync(destination) || !existsSync(metadataPath)) return false;
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (metadata.version !== version || metadata.rustTriple !== target.rustTriple) return false;
    return nodeVersion(destination) === `v${version}`;
  } catch {
    return false;
  }
}

function nodeVersion(path) {
  const result = spawnSync(path, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return (result.stdout ?? '').trim();
}

async function main() {
  if (cachedSidecarMatches()) {
    console.log(`[fetch-node-sidecar] sidecar already present for ${target.rustTriple}: ${destination}`);
    return;
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-node-'));
  const archivePath = join(temporaryRoot, archiveName);
  const extractDir = join(temporaryRoot, 'extract');
  try {
    console.log(`[fetch-node-sidecar] downloading ${archiveUrl}`);
    await download(archiveUrl, archivePath);
    extractArchive(archivePath, extractDir);
    const sourcePath = extractionPath(extractDir, sourceMember);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`Node executable not found in archive: ${sourceMember}`);
    }
    mkdirSync(dirname(destination), { recursive: true });
    const stagedDestination = join(temporaryRoot, target.sidecarBasename);
    copyFileSync(sourcePath, stagedDestination);
    if (process.platform !== 'win32') chmodSync(stagedDestination, 0o755);
    if (nodeVersion(stagedDestination) !== `v${version}`) {
      throw new Error(`Node sidecar reported an unexpected version; expected v${version}`);
    }
    rmSync(destination, { force: true });
    rmSync(metadataPath, { force: true });
    copyFileSync(stagedDestination, destination);
    if (process.platform !== 'win32') chmodSync(destination, 0o755);
    writeFileSync(metadataPath, `${JSON.stringify({ version, rustTriple: target.rustTriple }, null, 2)}\n`);
    console.log(`[fetch-node-sidecar] sidecar at ${destination}`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[fetch-node-sidecar] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

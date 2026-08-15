// Downloads the portable Node distribution and extracts node.exe as the
// dsh-desktop sidecar (src-tauri/binaries/node-x86_64-pc-windows-msvc.exe).
//
// The official Windows zip ships npm/corepack alongside node.exe, but the
// sidecar carries node.exe only: a packaged runtime has no npm and installs
// the bridge offline by copying packages (see main.rs RuntimePaths).
//
// Honors HTTPS_PROXY/HTTP_PROXY for the download. Run before `tauri build`;
// the binary is gitignored, not committed.
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src-tauri/binaries/node-x86_64-pc-windows-msvc.exe');
const version = process.env.DSH_NODE_VERSION ?? '22.23.1';

if (existsSync(target)) {
  console.log('[fetch-node-sidecar] sidecar already present: ' + target);
  process.exit(0);
}

const zipUrl = `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`;
const tmp = join(process.env.TEMP ?? '/tmp', `dsh-node-${version}-win-x64.zip`);
const extract = join(process.env.TEMP ?? '/tmp', `dsh-node-${version}-x`);

async function download(url) {
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (proxy) {
    // Validate the proxy URL early; curl uses it directly.
    new URL(proxy);
    execFileSync('curl', ['-L', '--proxy', proxy, '-o', tmp, url], { stdio: 'inherit' });
    return;
  }
  await new Promise((resolveDone, reject) => {
    const out = createWriteStream(tmp);
    get(url, (res) => {
      res.pipe(out);
      out.on('finish', () => { out.close(); resolveDone(); });
    }).on('error', reject);
  });
}

async function main() {
  console.log('[fetch-node-sidecar] downloading ' + zipUrl);
  await download(zipUrl);
  mkdirSync(dirname(target), { recursive: true });
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -Force '${tmp}' '${extract}'`], { stdio: 'inherit' });
  const nodeExe = join(extract, `node-v${version}-win-x64`, 'node.exe');
  if (!existsSync(nodeExe)) {
    console.error('[fetch-node-sidecar] node.exe not found after extraction');
    process.exit(1);
  }
  execFileSync('cmd', ['/c', 'copy', '/Y', nodeExe, target], { stdio: 'inherit' });
  console.log('[fetch-node-sidecar] sidecar at ' + target);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

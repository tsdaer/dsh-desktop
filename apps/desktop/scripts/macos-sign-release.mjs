import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Read the credentials required for a signed macOS release.
 *
 * @param {NodeJS.ProcessEnv} env Environment containing CI signing inputs.
 * @returns {{app: string, dmg: string, archive: string, identity: string, appleId: string, applePassword: string, teamId: string, entitlements: string, updaterPrivateKey: string}}
 */
export function readSigningInputs(env = process.env) {
  const required = (name) => {
    const value = env[name];
    if (value === undefined || value.trim().length === 0) throw new Error(`${name} is required for signed macOS releases`);
    return value;
  };
  return {
    app: required('DSH_MACOS_APP'),
    dmg: required('DSH_MACOS_DMG'),
    archive: required('DSH_MACOS_ARCHIVE'),
    identity: required('MACOS_SIGNING_IDENTITY'),
    appleId: required('APPLE_ID'),
    applePassword: required('APPLE_APP_SPECIFIC_PASSWORD'),
    teamId: required('APPLE_TEAM_ID'),
    entitlements: env.MACOS_ENTITLEMENTS ?? 'src-tauri/entitlements.plist',
    updaterPrivateKey: required('TAURI_SIGNING_PRIVATE_KEY'),
  };
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isNestedCode(file) {
  const extension = extname(file).toLowerCase();
  if (['.dylib', '.node', '.bundle', '.so'].includes(extension)) return true;
  return (statSync(file).mode & 0o111) !== 0 && !file.endsWith('.plist');
}

/**
 * Return nested code paths in signing order, excluding the outer app bundle.
 * @param {string} app App bundle path.
 * @returns {string[]}
 */
export function nestedCodePaths(app) {
  if (!existsSync(app) || !statSync(app).isDirectory() || !app.endsWith('.app')) {
    throw new Error(`macOS app bundle is missing or invalid: ${app}`);
  }
  return walkFiles(app)
    .filter(isNestedCode)
    .sort((left, right) => right.length - left.length);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function verifyInputFiles(inputs) {
  if (!existsSync(inputs.archive) || !statSync(inputs.archive).isFile()) throw new Error(`macOS updater archive is missing: ${inputs.archive}`);
  if (!existsSync(inputs.dmg) || !statSync(inputs.dmg).isFile()) throw new Error(`macOS dmg is missing: ${inputs.dmg}`);
}

function refreshUpdaterArchive(inputs, execute) {
  execute('tar', ['-czf', inputs.archive, '-C', dirname(inputs.app), basename(inputs.app)]);
  execute('pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'exec', 'tauri', 'signer', 'sign', inputs.archive], {
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: inputs.updaterPrivateKey },
  });
}

/**
 * Verify the Tauri-signed app, notarize and staple its dmg, then verify the
 * stapled app with Gatekeeper. Tauri signs the app during bundle creation so
 * the updater archive remains byte-for-byte consistent with the signed app.
 * Secrets are passed only to child processes and are never logged by this script.
 *
 * @param {ReturnType<typeof readSigningInputs>} inputs Signing paths and credentials.
 * @param {{run?: typeof run}} [options] Test adapters.
 * @returns {Promise<void>}
 */
export async function signMacosRelease(inputs, options = {}) {
  if (process.platform !== 'darwin') throw new Error('macOS signing must run on a macOS runner');
  verifyInputFiles(inputs);
  const execute = options.run ?? run;
  for (const path of nestedCodePaths(inputs.app)) {
    execute('codesign', ['--verify', '--strict', '--verbose=2', path]);
  }
  execute('codesign', ['--verify', '--deep', '--strict', '--verbose=2', inputs.app]);
  execute('xcrun', ['notarytool', 'submit', inputs.dmg, '--apple-id', inputs.appleId, '--password', inputs.applePassword, '--team-id', inputs.teamId, '--wait']);
  execute('xcrun', ['stapler', 'staple', inputs.app]);
  execute('xcrun', ['stapler', 'staple', inputs.dmg]);
  execute('spctl', ['--assess', '--type', 'execute', '--verbose=4', inputs.app]);
  refreshUpdaterArchive(inputs, execute);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  signMacosRelease(readSigningInputs()).catch((error) => {
    console.error(`[macos-sign-release] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

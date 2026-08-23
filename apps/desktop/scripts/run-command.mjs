// Run synchronous package-management and installer commands with a bounded
// captured-output allowance large enough for the baked desktop runtime.
import { spawnSync } from 'node:child_process';

const capturedCommandOutputLimit = 16 * 1024 * 1024;

/**
 * Run a command and return captured stdout.
 *
 * @param {string} command Executable to run.
 * @param {readonly string[]} args Arguments passed without shell interpolation.
 * @param {import('node:child_process').SpawnSyncOptions} [options] Spawn options.
 * @returns {string} Captured stdout, or an empty string when stdio is inherited.
 */
export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: capturedCommandOutputLimit,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

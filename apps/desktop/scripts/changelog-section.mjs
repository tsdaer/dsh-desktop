// Print the CHANGELOG.md section for one version, for the draft-release workflow
// to use as the GitHub release notes. Exits non-zero when the section is absent.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
  console.error('usage: node changelog-section.mjs <version>');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const changelog = resolve(here, '../CHANGELOG.md');
const lines = readFileSync(changelog, 'utf8').split('\n');

const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`[changelog-section] no "## [${version}]" section in ${changelog}`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i += 1) {
  if (/^## \[/.test(lines[i])) {
    end = i;
    break;
  }
}

process.stdout.write(`${lines.slice(start, end).join('\n').trim()}\n`);

// Generate every packaged icon from the single transparent black source at
// src/icon.svg. The same SVG is served by the splash page.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const iconsDir = resolve(here, '../src-tauri/icons');
const source = resolve(here, '../src/icon.svg');

function findSharp() {
  const pnpmDir = join(repoRoot, 'node_modules/.pnpm');
  if (!existsSync(pnpmDir)) return null;
  for (const name of readdirSync(pnpmDir).filter((entry) => entry.startsWith('sharp@'))) {
    const entry = join(pnpmDir, name, 'node_modules/sharp/dist/index.mjs');
    if (existsSync(entry)) return entry;
  }
  return null;
}

function wrapIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(images.length * 16);
  let offset = 6 + entries.length;
  images.forEach(({ size, png }, index) => {
    const entry = entries.subarray(index * 16, (index + 1) * 16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images.map(({ png }) => png)]);
}

async function main() {
  const sharpEntry = findSharp();
  if (sharpEntry === null) throw new Error('sharp is required to generate desktop icons');
  const sharp = (await import('file:///' + sharpEntry.replace(/\\/g, '/'))).default;
  const svg = readFileSync(source);
  const splash = readFileSync(resolve(here, '../src/splashscreen.html'), 'utf8');
  if (!svg.includes('fill="#000"')) throw new Error('desktop icon source must be black');
  if (!splash.includes('<img src="icon.svg" alt="" />')) throw new Error('splash must use src/icon.svg');
  const sizes = [16, 32, 48, 256, 512];
  const images = await Promise.all(sizes.map(async (size) => ({
    size,
    png: await sharp(svg)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  })));
  if (images.length !== sizes.length || images.some(({ png }) => png.length === 0)) {
    throw new Error('desktop icon generation did not produce every requested size');
  }
  mkdirSync(iconsDir, { recursive: true });
  const png256 = images.find(({ size }) => size === 256).png;
  const png512 = images.find(({ size }) => size === 512).png;
  writeFileSync(join(iconsDir, 'icon.png'), png256);
  writeFileSync(join(iconsDir, 'icon-512.png'), png512);
  writeFileSync(join(iconsDir, 'icon.ico'), wrapIco(images.filter(({ size }) => size !== 512)));
  console.log('wrote icon.ico, icon.png, icon-512.png from src/icon.svg');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

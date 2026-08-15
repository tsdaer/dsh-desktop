// Generates the app icons from the DeepSeek fish logo, whose single source is
// packages/client/ui-primitives/src/FishLogo.tsx (the path data is extracted
// from that file, never copied). Produces:
//
//   src-tauri/icons/icon.ico      Windows resource (PNG-embedded 256x256)
//   src-tauri/icons/icon.png      256x256
//   src-tauri/icons/icon-512.png  512x512
//
// Requires the repo's node_modules (sharp via the pnpm store). Falls back to
// a generated placeholder when sharp is unavailable.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const iconsDir = resolve(here, '../src-tauri/icons');
const fishSource = resolve(repoRoot, 'packages/client/ui-primitives/src/FishLogo.tsx');

const FISH_FILL = '#4d9fff';
const PADDING_RATIO = 0.12;
const VB_W = 23.16;
const VB_H = 17.04;

function fishPathData() {
  const src = readFileSync(fishSource, 'utf8');
  const match = src.match(/<path\s+d="([^"]+)"/);
  if (!match) throw new Error('FishLogo path not found in ' + fishSource);
  return match[1];
}

function fishSvg(size) {
  const usable = size * (1 - 2 * PADDING_RATIO);
  const scale = Math.min(usable / VB_W, usable / VB_H);
  const tx = (size - VB_W * scale) / 2;
  const ty = (size - VB_H * scale) / 2;
  const d = fishPathData();
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 ' + size + ' ' + size + '"><g transform="translate(' +
    tx.toFixed(2) + ' ' + ty.toFixed(2) + ') scale(' + scale.toFixed(4) + ')">' +
    '<path d="' + d + '" fill="' + FISH_FILL + '"/></g></svg>';
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function pngFromRgba(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function wrapIco(pngBytes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBytes.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBytes]);
}

function placeholderPng(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      px[i] = 15; px[i + 1] = 17; px[i + 2] = 23; px[i + 3] = 255;
    }
  }
  return pngFromRgba(size, px);
}

function findSharp() {
  const pnpmDir = join(repoRoot, 'node_modules/.pnpm');
  if (!existsSync(pnpmDir)) return null;
  const candidates = readdirSync(pnpmDir).filter((name) => name.startsWith('sharp@'));
  for (const name of candidates) {
    const entry = join(pnpmDir, name, 'node_modules/sharp/dist/index.mjs');
    if (existsSync(entry)) return entry;
  }
  return null;
}

async function main() {
  mkdirSync(iconsDir, { recursive: true });
  const sharpEntry = findSharp();
  if (sharpEntry) {
    const sharp = (await import('file:///' + sharpEntry.replace(/\\/g, '/'))).default;
    const png256 = await sharp(Buffer.from(fishSvg(256))).png().toBuffer();
    writeFileSync(join(iconsDir, 'icon.png'), png256);
    writeFileSync(join(iconsDir, 'icon.ico'), wrapIco(png256));
    const png512 = await sharp(Buffer.from(fishSvg(512))).png().toBuffer();
    writeFileSync(join(iconsDir, 'icon-512.png'), png512);
    console.log('wrote icon.ico, icon.png, icon-512.png from FishLogo (sharp)');
  } else {
    const png = placeholderPng(256);
    writeFileSync(join(iconsDir, 'icon.ico'), wrapIco(png));
    writeFileSync(join(iconsDir, 'icon.png'), png);
    console.log('wrote placeholder icons (sharp unavailable)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

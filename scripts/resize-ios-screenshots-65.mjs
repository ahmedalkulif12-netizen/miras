/**
 * Fit iOS App Store screenshots to iPhone 6.5" portrait: 1242×2688.
 * Scales uniformly (no stretch) and pads with the Miras cream background.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_W = 1242;
const TARGET_H = 2688;
const BACKGROUND = { r: 248, g: 249, b: 251 };

const DEFAULT_DIRS = [
  path.join(root, 'fastlane', 'screenshots'),
  path.join(root, 'store', 'ios', 'iphone-6.5'),
];

function collectPngs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectPngs(full, acc);
    else if (/\.png$/i.test(entry.name)) acc.push(full);
  }
  return acc;
}

async function fitTo65(file) {
  const before = await sharp(file).metadata();
  if (before.width === TARGET_W && before.height === TARGET_H) {
    return { file, skipped: true, width: before.width, height: before.height };
  }

  const buffer = await sharp(file)
    .resize(TARGET_W, TARGET_H, {
      fit: 'contain',
      background: BACKGROUND,
      withoutEnlargement: false,
    })
    .flatten({ background: BACKGROUND })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  const after = await sharp(buffer).metadata();
  if (after.width !== TARGET_W || after.height !== TARGET_H) {
    throw new Error(
      `${path.relative(root, file)} came out ${after.width}x${after.height}, expected ${TARGET_W}x${TARGET_H}`
    );
  }

  await fs.promises.writeFile(file, buffer);
  return {
    file,
    skipped: false,
    from: `${before.width}x${before.height}`,
    width: after.width,
    height: after.height,
  };
}

async function main() {
  const extra = process.argv.slice(2).map((dir) => path.resolve(dir));
  const dirs = extra.length ? extra : DEFAULT_DIRS;
  const files = dirs.flatMap((dir) => collectPngs(dir));
  if (!files.length) {
    console.error('No PNG screenshots found in', dirs.map((dir) => path.relative(root, dir)).join(', '));
    process.exit(1);
  }

  for (const file of files) {
    const result = await fitTo65(file);
    const rel = path.relative(root, file);
    if (result.skipped) {
      console.log(`ok     ${TARGET_W}x${TARGET_H}  ${rel}`);
    } else {
      console.log(`wrote  ${result.from} → ${result.width}x${result.height}  ${rel}`);
    }
  }
  console.log(`Done. ${files.length} PNG(s) at ${TARGET_W}x${TARGET_H}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

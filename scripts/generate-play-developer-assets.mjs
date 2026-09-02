/**
 * Google Play Developer Profile assets from the Miras logo.
 * Official sizes: icon 512×512 (32-bit PNG, no transparency),
 * header 4096×2304 (JPG / 24-bit PNG, no alpha).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'resources', 'icon.png');
const outDir = path.join(root, 'store', 'play-developer');

const YELLOW = { r: 252, g: 198, b: 25 };
const CREAM = { r: 248, g: 249, b: 251 };

function circleMask(size) {
  const r = size / 2 - Math.max(2, Math.round(size * 0.012));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="white"/>
    </svg>`
  );
}

async function circularLogo(size) {
  const masked = await sharp(src)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .composite([{ input: circleMask(size), blend: 'dest-in' }])
    .png()
    .toBuffer();
  return masked;
}

async function writeDeveloperIcon() {
  const logo = await circularLogo(512);
  const file = path.join(outDir, 'developer-icon-512.png');
  await sharp({
    create: { width: 512, height: 512, channels: 3, background: YELLOW },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .flatten({ background: YELLOW })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(file);
  return file;
}

async function writeHeader(width, height, filename) {
  const logoSize = Math.round(height * 0.62);
  const logo = await circularLogo(logoSize);
  const logoLeft = Math.round(width * 0.12);
  const logoTop = Math.round((height - logoSize) / 2);
  const textLeft = logoLeft + logoSize + Math.round(width * 0.04);
  const textWidth = width - textLeft - Math.round(width * 0.08);

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#F8F9FB"/>
    <rect width="${Math.round(width * 0.42)}" height="${height}" fill="#FCC619"/>
    <text x="${textLeft}" y="${Math.round(height * 0.46)}" fill="#111111" font-size="${Math.round(height * 0.16)}" font-family="Arial, Helvetica, sans-serif" font-weight="800">مَرَاس</text>
    <text x="${textLeft}" y="${Math.round(height * 0.58)}" fill="#111111" font-size="${Math.round(height * 0.08)}" font-family="Arial, Helvetica, sans-serif" font-weight="700">Miras</text>
    <text x="${textLeft}" y="${Math.round(height * 0.68)}" fill="#5C5346" font-size="${Math.round(height * 0.038)}" font-family="Arial, Helvetica, sans-serif" font-weight="600">Logistics &amp; transport — Saudi Arabia</text>
  </svg>`);

  const file = path.join(outDir, filename);
  await sharp(svg)
    .composite([{ input: logo, left: logoLeft, top: logoTop }])
    .flatten({ background: CREAM })
    .removeAlpha()
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(file);

  // Play Console also accepts 24-bit PNG; keep a PNG next to the JPEG.
  const pngFile = file.replace(/\.jpe?g$/i, '.png');
  await sharp(svg)
    .composite([{ input: logo, left: logoLeft, top: logoTop }])
    .flatten({ background: CREAM })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(pngFile);

  void textWidth;
  return { jpg: file, png: pngFile };
}

async function report(file) {
  const meta = await sharp(file).metadata();
  const stat = fs.statSync(file);
  return `${path.basename(file)}  ${meta.width}x${meta.height}  alpha=${Boolean(meta.hasAlpha)}  channels=${meta.channels}  ${(stat.size / 1024).toFixed(0)} KB`;
}

async function main() {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing logo: ${src}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const icon = await writeDeveloperIcon();
  const official = await writeHeader(4096, 2304, 'header-4096x2304.jpg');
  const requested = await writeHeader(4048, 2304, 'header-4048x2304.jpg');

  console.log(await report(icon));
  console.log(await report(official.jpg));
  console.log(await report(official.png));
  console.log(await report(requested.jpg));
  console.log(await report(requested.png));
  console.log(`Wrote assets to ${path.relative(root, outDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

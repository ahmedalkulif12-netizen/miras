/**
 * Generate store-ready launcher icons and splash screens.
 * Prefers app_icon.png (repo root, resources/, or src/components/).
 * Falls back to src/components/jz-logo.svg.
 * Apple requires a 1024×1024 icon with no alpha channel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON_BG = { r: 0, g: 0, b: 0 };
const SPLASH_BG = { r: 0, g: 0, b: 0, alpha: 1 };

function resolveBadge() {
  const candidates = [
    path.join(root, 'app_icon.png'),
    path.join(root, 'resources', 'app_icon.png'),
    path.join(root, 'src', 'components', 'app_icon.png'),
    path.join(root, 'src', 'components', 'jz-logo.svg'),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    throw new Error(`No icon source. Place app_icon.png in the repo root. Looked in:\n${candidates.join('\n')}`);
  }
  return found;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function writePng(target, pipeline) {
  ensureDir(target);
  await pipeline.png({ compressionLevel: 9 }).toFile(target);
}

/** App Store 1024 icon must be 24-bit RGB with no alpha channel. */
async function writeOpaquePng(target, pipeline) {
  ensureDir(target);
  await pipeline
    .flatten({ background: ICON_BG })
    .removeAlpha()
    .toColourspace('srgb')
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toFile(target);
}

async function opaqueIcon(size, badge) {
  const badgeLayer = await sharp(badge)
    .resize(size, size, {
      fit: 'contain',
      background: { r: ICON_BG.r, g: ICON_BG.g, b: ICON_BG.b, alpha: 1 },
    })
    .flatten({ background: ICON_BG })
    .removeAlpha()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: ICON_BG,
    },
  }).composite([{ input: badgeLayer, gravity: 'centre' }]);
}

async function assertOpaquePng(filePath) {
  const meta = await sharp(filePath).metadata();
  if (meta.hasAlpha || (meta.channels ?? 0) > 3) {
    throw new Error(
      `App Store icon still has an alpha channel: ${filePath} (channels=${meta.channels}, hasAlpha=${meta.hasAlpha})`
    );
  }
}

async function splash(width, height, badge) {
  const markSize = Math.round(Math.min(width, height) * 0.28);
  const logo = await sharp(badge)
    .resize(markSize, markSize, { fit: 'contain', background: SPLASH_BG })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: SPLASH_BG,
    },
  }).composite([{ input: logo, gravity: 'centre' }]);
}

const androidLaunchers = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

const androidForeground = [
  ['mipmap-mdpi', 108],
  ['mipmap-hdpi', 162],
  ['mipmap-xhdpi', 216],
  ['mipmap-xxhdpi', 324],
  ['mipmap-xxxhdpi', 432],
];

const androidPortSplash = [
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];

const androidLandSplash = [
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
];

async function main() {
  const badge = resolveBadge();
  console.log(`Icon source: ${path.relative(root, badge)}`);

  const iosIcon = path.join(
    root,
    'ios',
    'App',
    'App',
    'Assets.xcassets',
    'AppIcon.appiconset',
    'AppIcon-512@2x.png'
  );
  await writeOpaquePng(iosIcon, await opaqueIcon(1024, badge));
  await assertOpaquePng(iosIcon);

  const splashDir = path.join(
    root,
    'ios',
    'App',
    'App',
    'Assets.xcassets',
    'Splash.imageset'
  );
  const splash2732 = await splash(2732, 2732, badge);
  await writePng(path.join(splashDir, 'splash-2732x2732.png'), splash2732);
  await writePng(path.join(splashDir, 'splash-2732x2732-1.png'), await splash(2732, 2732, badge));
  await writePng(path.join(splashDir, 'splash-2732x2732-2.png'), await splash(2732, 2732, badge));

  const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');
  for (const [folder, size] of androidLaunchers) {
    const icon = await opaqueIcon(size, badge);
    await writeOpaquePng(path.join(androidRes, folder, 'ic_launcher.png'), icon);
    await writeOpaquePng(path.join(androidRes, folder, 'ic_launcher_round.png'), await opaqueIcon(size, badge));
  }
  for (const [folder, size] of androidForeground) {
    await writeOpaquePng(
      path.join(androidRes, folder, 'ic_launcher_foreground.png'),
      await opaqueIcon(size, badge)
    );
  }

  await writePng(path.join(androidRes, 'drawable', 'splash.png'), await splash(1080, 1920, badge));
  for (const [folder, w, h] of androidPortSplash) {
    await writePng(path.join(androidRes, folder, 'splash.png'), await splash(w, h, badge));
  }
  for (const [folder, w, h] of androidLandSplash) {
    await writePng(path.join(androidRes, folder, 'splash.png'), await splash(w, h, badge));
  }

  const publicDir = path.join(root, 'public');
  const badge1024 = sharp(badge).resize(1024, 1024);
  await writePng(path.join(publicDir, 'jz-badge.png'), badge1024);
  await writePng(path.join(publicDir, 'miras-badge.png'), sharp(badge).resize(1024, 1024));
  await writePng(path.join(root, 'src', 'components', 'jz-badge.png'), sharp(badge).resize(1024, 1024));
  await writeOpaquePng(path.join(publicDir, 'jz-app-icon.png'), await opaqueIcon(1024, badge));
  await writeOpaquePng(path.join(publicDir, 'miras-app-icon.png'), await opaqueIcon(1024, badge));

  const listingIcon = await opaqueIcon(512, badge);
  await writeOpaquePng(path.join(root, 'store', 'android', 'hi-res-icon.png'), listingIcon);
  await writeOpaquePng(path.join(root, 'fastlane', 'metadata', 'android', 'en-US', 'images', 'icon.png'), await opaqueIcon(512, badge));
  await writeOpaquePng(path.join(root, 'fastlane', 'metadata', 'android', 'ar', 'images', 'icon.png'), await opaqueIcon(512, badge));

  const resources = path.join(root, 'resources');
  fs.mkdirSync(resources, { recursive: true });
  await writeOpaquePng(path.join(resources, 'icon.png'), await opaqueIcon(1024, badge));
  await writePng(path.join(resources, 'splash.png'), await splash(2732, 2732, badge));

  console.log('Generated JZ Logistics launcher icons and splash screens.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

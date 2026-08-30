/**
 * Prepare Play / App Store screenshots from captured phone JPEGs.
 * Crops Safari chrome, writes 24-bit PNGs at official listing sizes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const incoming = path.join(root, 'store', 'incoming');
const YELLOW = { r: 248, g: 195, b: 30 };
const CREAM = { r: 248, g: 249, b: 251 };

/** Best unique frames for store listing (skip duplicate privacy scrolls). */
const SHOTS = [
  { src: 'src-01.jpg', slug: '01-landing-hero', title: 'Landing — cargo made easier' },
  { src: 'src-05.jpg', slug: '02-logistics-services', title: 'Logistics service catalog' },
  { src: 'src-06.jpg', slug: '03-account-type', title: 'Customer or driver signup' },
  { src: 'src-14.jpg', slug: '04-customer-booking', title: 'Customer booking dashboard' },
  { src: 'src-16.jpg', slug: '05-instant-quote', title: 'Instant quote and fare' },
  { src: 'src-17.jpg', slug: '06-order-checkout', title: 'Order summary and checkout' },
  { src: 'src-20.jpg', slug: '07-driver-on-shift', title: 'Driver on-shift dashboard' },
  { src: 'src-21.jpg', slug: '08-secure-wallet', title: 'Wallet — Moyasar only' },
  { src: 'src-18.jpg', slug: '09-driver-ratings', title: 'Driver ratings' },
  { src: 'src-08.jpg', slug: '10-privacy-policy', title: 'In-app privacy policy' },
];

const TARGETS = {
  playPhone: { w: 1080, h: 1920, dir: 'android/phone' },
  play7: { w: 1200, h: 1920, dir: 'android/sevenInch' },
  play10: { w: 1600, h: 2560, dir: 'android/tenInch' },
  ios67: { w: 1290, h: 2796, dir: 'ios/iphone-6.7' },
  ios65: { w: 1284, h: 2778, dir: 'ios/iphone-6.5' },
  ios55: { w: 1242, h: 2208, dir: 'ios/iphone-5.5' },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function cropSafariChrome(filePath) {
  const meta = await sharp(filePath).metadata();
  const width = meta.width || 740;
  const height = meta.height || 1600;
  const top = Math.round(height * 0.015);
  const bottomCrop = Math.round(height * 0.13);
  const cropH = height - top - bottomCrop;
  return sharp(filePath)
    .extract({ left: 0, top, width, height: cropH })
    .removeAlpha()
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function fitOnCanvas(buffer, width, height) {
  const fitted = await sharp(buffer)
    .resize(width, height, {
      fit: 'contain',
      background: CREAM,
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return sharp({
    create: { width, height, channels: 3, background: CREAM },
  })
    .composite([{ input: fitted, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function writeFeatureGraphic(landingBuffer) {
  const w = 1024;
  const h = 500;
  const photo = await sharp(landingBuffer)
    .resize(1024, 500, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 0.72 })
    .png()
    .toBuffer();

  const badgePath = path.join(root, 'src', 'components', 'miras-badge.png');
  const logo = await sharp(badgePath)
    .resize(160, 160, { fit: 'cover' })
    .flatten({ background: YELLOW })
    .png()
    .toBuffer();

  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" fill="rgba(15,15,15,0.28)"/>
      <text x="210" y="230" fill="white" font-size="72" font-family="Arial, Helvetica, sans-serif" font-weight="800">مَرَاس</text>
      <text x="210" y="290" fill="white" font-size="36" font-family="Arial, Helvetica, sans-serif" font-weight="700">Miras</text>
      <text x="210" y="340" fill="#F8C31E" font-size="22" font-family="Arial, Helvetica, sans-serif" font-weight="600">Logistics &amp; transport — Saudi Arabia</text>
    </svg>`
  );

  return sharp(photo)
    .composite([
      { input: logo, left: 36, top: 170 },
      { input: svg, gravity: 'centre' },
    ])
    .removeAlpha()
    .png()
    .toBuffer();
}

async function main() {
  const playLimit = SHOTS.slice(0, 8);
  const iosShots = SHOTS;

  for (const [key, spec] of Object.entries(TARGETS)) {
    const destRoot = path.join(root, 'store', spec.dir);
    ensureDir(destRoot);
    const list = key.startsWith('play') ? playLimit : iosShots;
    for (const shot of list) {
      const src = path.join(incoming, shot.src);
      if (!fs.existsSync(src)) throw new Error(`Missing ${src}`);
      const cropped = await cropSafariChrome(src);
      const framed = await fitOnCanvas(cropped, spec.w, spec.h);
      const out = path.join(destRoot, `${shot.slug}.png`);
      await sharp(framed).png().toFile(out);
      console.log('wrote', path.relative(root, out));
    }
  }

  const landing = await cropSafariChrome(path.join(incoming, 'src-01.jpg'));
  const feature = await writeFeatureGraphic(landing);
  const featurePath = path.join(root, 'store', 'android', 'featureGraphic.png');
  ensureDir(path.dirname(featurePath));
  await sharp(feature).png().toFile(featurePath);

  const playIcon = path.join(root, 'store', 'android', 'hi-res-icon.png');
  await sharp(path.join(root, 'src', 'components', 'miras-badge.png'))
    .resize(512, 512, { fit: 'cover' })
    .flatten({ background: YELLOW })
    .removeAlpha()
    .png()
    .toFile(playIcon);

  const localeCopies = [
    ['store/android/phone', 'fastlane/metadata/android/ar/images/phoneScreenshots'],
    ['store/android/phone', 'fastlane/metadata/android/en-US/images/phoneScreenshots'],
    ['store/android/sevenInch', 'fastlane/metadata/android/ar/images/sevenInchScreenshots'],
    ['store/android/sevenInch', 'fastlane/metadata/android/en-US/images/sevenInchScreenshots'],
    ['store/android/tenInch', 'fastlane/metadata/android/ar/images/tenInchScreenshots'],
    ['store/android/tenInch', 'fastlane/metadata/android/en-US/images/tenInchScreenshots'],
    ['store/ios/iphone-6.7', 'fastlane/screenshots/ar-SA'],
    ['store/ios/iphone-6.7', 'fastlane/screenshots/en-US'],
  ];

  for (const [fromRel, toRel] of localeCopies) {
    const from = path.join(root, fromRel);
    const to = path.join(root, toRel);
    ensureDir(to);
    for (const file of fs.readdirSync(from)) {
      fs.copyFileSync(path.join(from, file), path.join(to, file));
    }
  }
  fs.copyFileSync(featurePath, path.join(root, 'fastlane/metadata/android/ar/images/featureGraphic.png'));
  fs.copyFileSync(featurePath, path.join(root, 'fastlane/metadata/android/en-US/images/featureGraphic.png'));
  ensureDir(path.join(root, 'fastlane/metadata/android/ar/images'));
  fs.copyFileSync(playIcon, path.join(root, 'fastlane/metadata/android/ar/images/icon.png'));
  fs.copyFileSync(playIcon, path.join(root, 'fastlane/metadata/android/en-US/images/icon.png'));

  console.log('feature graphic', path.relative(root, featurePath));
  console.log('play icon', path.relative(root, playIcon));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

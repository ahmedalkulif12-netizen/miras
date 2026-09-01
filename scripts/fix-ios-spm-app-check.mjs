/**
 * Give @capacitor-firebase/app-check a unique SwiftPM identity.
 *
 * SPM ignores Package.swift `name:` for local packages and uses the last path
 * component instead. Pointing at node_modules/.../app-check collides with
 * github.com/google/app-check (AppCheckCore) from firebase-ios-sdk.
 *
 * Capacitor CLI 8.4+ with experimental.ios.spm.packageOptions symlink:true
 * should already write CapApp-SPM/symlinks/<PluginName>. This script is the
 * post-sync guard: create that link if missing, rewrite colliding paths, and
 * fail if the identity is still `app-check`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageSwiftPath = path.join(root, 'ios', 'App', 'CapApp-SPM', 'Package.swift');
const pluginDir = path.join(root, 'node_modules', '@capacitor-firebase', 'app-check');
const symlinkDir = path.join(root, 'ios', 'App', 'CapApp-SPM', 'symlinks');
const linkName = 'CapacitorFirebaseAppCheck';
const linkPath = path.join(symlinkDir, linkName);
const uniqueRelPath = `symlinks/${linkName}`;

if (!fs.existsSync(packageSwiftPath)) {
  console.log('No CapApp-SPM/Package.swift; skipping SPM app-check fix.');
  process.exit(0);
}

if (!fs.existsSync(pluginDir)) {
  console.error('Missing node_modules/@capacitor-firebase/app-check. Run npm ci first.');
  process.exit(1);
}

fs.mkdirSync(symlinkDir, { recursive: true });

function ensurePluginLink() {
  try {
    fs.lstatSync(linkPath);
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {
    // missing
  }
  try {
    fs.symlinkSync(pluginDir, linkPath, 'junction');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to symlink ${linkPath} -> ${pluginDir}: ${message}`);
    process.exit(1);
  }
}

ensurePluginLink();

let text = fs.readFileSync(packageSwiftPath, 'utf8');
text = text.replace(/\\/g, '/');
text = text.replace(
  /path:\s*"([^"]*@capacitor-firebase\/app-check)"/g,
  `path: "${uniqueRelPath}"`,
);

const iosPkgPath = path.join(root, 'node_modules', '@capacitor', 'ios', 'package.json');
if (fs.existsSync(iosPkgPath)) {
  const iosVersion = JSON.parse(fs.readFileSync(iosPkgPath, 'utf8')).version;
  if (typeof iosVersion === 'string' && /^\d+\.\d+\.\d+/.test(iosVersion)) {
    text = text.replace(
      /\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", exact: "[^"]+"\)/,
      `.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "${iosVersion}")`,
    );
  }
}
text = text.replace(/path:\s*"([^"]*\/app-check)"/g, (full, value) => {
  if (String(value).includes('@capacitor-firebase/')) {
    return `path: "${uniqueRelPath}"`;
  }
  return full;
});
fs.writeFileSync(packageSwiftPath, text);

const colliding = [...text.matchAll(/path:\s*"([^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => /(^|\/)app-check$/.test(value));

if (colliding.length > 0) {
  console.error('SPM identity collision remains. Package.swift still points at:');
  for (const value of colliding) {
    console.error(`  ${value}`);
  }
  process.exit(1);
}

if (!text.includes(`path: "${uniqueRelPath}"`)) {
  console.error(`Package.swift is missing path: "${uniqueRelPath}" for CapacitorFirebaseAppCheck.`);
  process.exit(1);
}

console.log(`SPM app-check identity is ${linkName} (${uniqueRelPath}).`);

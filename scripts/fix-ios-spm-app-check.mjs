/**
 * Give @capacitor-firebase/app-check a unique SwiftPM identity that survives archive.
 *
 * SPM ignores Package.swift `name:` for local packages and uses the last path
 * component. A path ending in `app-check` collides with github.com/google/app-check
 * (AppCheckCore) from firebase-ios-sdk — Xcode then fails while linking Firebase
 * targets ("product 'AppCheckCore' ... not found in package 'app-check'").
 *
 * A symlink is not enough: `xcodebuild archive` realpath()s it back to
 * node_modules/.../app-check. Copy into a real directory named
 * CapacitorFirebaseAppCheck, and drop the plugin test target so archive does not
 * try to build XCTest for generic iOS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageSwiftPath = path.join(root, 'ios', 'App', 'CapApp-SPM', 'Package.swift');
const pluginDir = path.join(root, 'node_modules', '@capacitor-firebase', 'app-check');
const packagesDir = path.join(root, 'ios', 'App', 'CapApp-SPM', 'packages');
const destDir = path.join(packagesDir, 'CapacitorFirebaseAppCheck');
const uniqueRelPath = 'packages/CapacitorFirebaseAppCheck';

if (!fs.existsSync(packageSwiftPath)) {
  console.log('No CapApp-SPM/Package.swift; skipping SPM app-check fix.');
  process.exit(0);
}

if (!fs.existsSync(pluginDir)) {
  console.error('Missing node_modules/@capacitor-firebase/app-check. Run npm ci first.');
  process.exit(1);
}

function shouldCopy(src) {
  const rel = path.relative(pluginDir, src).replace(/\\/g, '/');
  if (!rel || rel === '.') return true;
  const skip = ['node_modules', 'android', 'dist', 'ios/PluginTests', 'ios/Tests', '.git'];
  return !skip.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

function copyPluginPackage() {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(packagesDir, { recursive: true });
  fs.cpSync(pluginDir, destDir, {
    recursive: true,
    dereference: true,
    filter: (src) => shouldCopy(src),
  });
}

function stripTestTargets(text) {
  return text
    .replace(/,\s*\.testTarget\s*\([\s\S]*?\)\s*/g, '\n')
    .replace(/\.testTarget\s*\([\s\S]*?\)\s*,?/g, '');
}

copyPluginPackage();

const copiedManifest = path.join(destDir, 'Package.swift');
if (!fs.existsSync(copiedManifest)) {
  console.error(`Copied plugin is missing Package.swift at ${copiedManifest}`);
  process.exit(1);
}
fs.writeFileSync(copiedManifest, stripTestTargets(fs.readFileSync(copiedManifest, 'utf8')));

const pluginSources = path.join(destDir, 'ios', 'Plugin');
if (!fs.existsSync(pluginSources)) {
  console.error(`Copied plugin is missing ios/Plugin at ${pluginSources}`);
  process.exit(1);
}

let text = fs.readFileSync(packageSwiftPath, 'utf8');
text = text.replace(/\\/g, '/');
const copiedPath = `path: "${uniqueRelPath}"`;
// Capacitor 8.5 with experimental.ios.spm.packageOptions.symlink writes
// `path: "symlinks/CapacitorFirebaseAppCheck"` (no leading directory).
// The old regex required a slash before `symlinks/`, so Codemagic `cap sync`
// left that path in place and this script exited 1.
text = text.replace(/path:\s*"[^"]*@capacitor-firebase\/app-check"/g, copiedPath);
text = text.replace(
  /path:\s*"[^"]*(?:symlinks|packages)\/CapacitorFirebaseAppCheck"/g,
  copiedPath,
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
text = text.replace(/path:\s*"([^"]+)"/g, (full, value) => {
  if (String(value).includes('@capacitor-firebase/') || /(^|\/)app-check$/.test(String(value))) {
    return copiedPath;
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

const destStat = fs.lstatSync(destDir);
if (destStat.isSymbolicLink()) {
  console.error(`${uniqueRelPath} must be a real directory, not a symlink (archive realpath would restore identity app-check).`);
  process.exit(1);
}

console.log(`SPM app-check identity is CapacitorFirebaseAppCheck (${uniqueRelPath}, copied, no test targets).`);

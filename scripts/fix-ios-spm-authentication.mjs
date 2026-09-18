/**
 * Copy @capacitor-firebase/authentication into a local SPM package and pin a
 * Swift 5.9 / Lite manifest (phone + FirebaseAuth only).
 *
 * Upstream 8.5 Package.swift is tools-version 6.1 with default Google/Facebook
 * traits. CapApp-SPM is 5.9 and must not pull Facebook/Google Sign-In SDKs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageSwiftPath = path.join(root, 'ios', 'App', 'CapApp-SPM', 'Package.swift');
const pluginDir = path.join(root, 'node_modules', '@capacitor-firebase', 'authentication');
const packagesDir = path.join(root, 'ios', 'App', 'CapApp-SPM', 'packages');
const destDir = path.join(packagesDir, 'CapacitorFirebaseAuthentication');
const uniqueRelPath = 'packages/CapacitorFirebaseAuthentication';

const liteManifest = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorFirebaseAuthentication",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorFirebaseAuthentication",
            targets: ["FirebaseAuthenticationPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", .upToNextMajor(from: "12.7.0"))
    ],
    targets: [
        .target(
            name: "FirebaseAuthenticationPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseCore", package: "firebase-ios-sdk")
            ],
            path: "ios/Plugin")
    ]
)
`;

if (!fs.existsSync(packageSwiftPath)) {
  console.log('No CapApp-SPM/Package.swift; skipping SPM authentication fix.');
  process.exit(0);
}

if (!fs.existsSync(pluginDir)) {
  console.error('Missing node_modules/@capacitor-firebase/authentication. Run npm ci first.');
  process.exit(1);
}

function shouldCopy(src) {
  const rel = path.relative(pluginDir, src).replace(/\\/g, '/');
  if (!rel || rel === '.') return true;
  const skip = ['node_modules', 'android', 'dist', 'ios/PluginTests', 'ios/Tests', '.git'];
  return !skip.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(packagesDir, { recursive: true });
fs.cpSync(pluginDir, destDir, {
  recursive: true,
  dereference: true,
  filter: (src) => shouldCopy(src),
});
fs.writeFileSync(path.join(destDir, 'Package.swift'), liteManifest);

if (!fs.existsSync(path.join(destDir, 'ios', 'Plugin'))) {
  console.error('Copied authentication plugin is missing ios/Plugin.');
  process.exit(1);
}

let text = fs.readFileSync(packageSwiftPath, 'utf8').replace(/\\/g, '/');
const copiedPath = `path: "${uniqueRelPath}"`;
text = text.replace(/path:\s*"[^"]*@capacitor-firebase\/authentication"/g, copiedPath);
text = text.replace(
  /path:\s*"[^"]*(?:symlinks|packages)\/CapacitorFirebaseAuthentication"/g,
  copiedPath,
);

if (!text.includes(`path: "${uniqueRelPath}"`)) {
  const depNeedle = '.package(name: "CapacitorFirebaseAppCheck", path: "packages/CapacitorFirebaseAppCheck"),';
  const prodNeedle = '.product(name: "CapacitorFirebaseAppCheck", package: "CapacitorFirebaseAppCheck"),';
  if (!text.includes(depNeedle) || !text.includes(prodNeedle)) {
    console.error('CapApp-SPM/Package.swift is missing CapacitorFirebaseAppCheck anchors for authentication insert.');
    process.exit(1);
  }
  text = text.replace(
    depNeedle,
    `${depNeedle}\n        .package(name: "CapacitorFirebaseAuthentication", ${copiedPath}),`,
  );
  text = text.replace(
    prodNeedle,
    `${prodNeedle}\n                .product(name: "CapacitorFirebaseAuthentication", package: "CapacitorFirebaseAuthentication"),`,
  );
}

fs.writeFileSync(packageSwiftPath, text);

text = injectFirebaseAuthForPhoneAuth(text);
fs.writeFileSync(packageSwiftPath, text);

if (!text.includes(`path: "${uniqueRelPath}"`)) {
  console.error(`Package.swift is missing path: "${uniqueRelPath}" for CapacitorFirebaseAuthentication.`);
  process.exit(1);
}

const destStat = fs.lstatSync(destDir);
if (destStat.isSymbolicLink()) {
  console.error(`${uniqueRelPath} must be a real directory, not a symlink.`);
  process.exit(1);
}

console.log(`SPM authentication is CapacitorFirebaseAuthentication (${uniqueRelPath}, Lite, no Google/Facebook SDKs).`);

function injectFirebaseAuthForPhoneAuth(source) {
  let next = source;
  const sdkDep =
    '.package(url: "https://github.com/firebase/firebase-ios-sdk.git", .upToNextMajor(from: "12.7.0")),';
  if (!next.includes('firebase-ios-sdk.git')) {
    next = next.replace(
      '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git"',
      `${sdkDep}\n        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git"`,
    );
  }
  const authProduct = '.product(name: "FirebaseAuth", package: "firebase-ios-sdk"),';
  const coreProduct = '.product(name: "FirebaseCore", package: "firebase-ios-sdk"),';
  if (!next.includes(authProduct)) {
    next = next.replace(
      '.product(name: "CapacitorFirebaseAuthentication", package: "CapacitorFirebaseAuthentication"),',
      `.product(name: "CapacitorFirebaseAuthentication", package: "CapacitorFirebaseAuthentication"),\n                ${authProduct}\n                ${coreProduct}`,
    );
  }

  const handlerPath = path.join(destDir, 'ios', 'Plugin', 'Handlers', 'PhoneAuthProviderHandler.swift');
  if (fs.existsSync(handlerPath)) {
    let handler = fs.readFileSync(handlerPath, 'utf8');
    if (!handler.includes('[PhoneAuth] Init native verifyPhoneNumber')) {
      handler = handler.replace(
        `    private func verifyPhoneNumber(_ options: SignInWithPhoneNumberOptions) {
        PhoneAuthProvider.provider()
            .verifyPhoneNumber(options.getPhoneNumber(), uiDelegate: nil) { verificationID, error in
                if let error = error {
                    self.pluginImplementation.handlePhoneVerificationFailed(error)
                } else {
                    self.pluginImplementation.handlePhoneCodeSent(verificationID ?? "")
                }
            }
    }`,
        `    private func verifyPhoneNumber(_ options: SignInWithPhoneNumberOptions) {
        let phoneNumber = options.getPhoneNumber()
        CAPLog.print("[PhoneAuth] Init native verifyPhoneNumber \\(phoneNumber)")
        PhoneAuthProvider.provider()
            .verifyPhoneNumber(phoneNumber, uiDelegate: nil) { verificationID, error in
                if let error = error {
                    CAPLog.print("[PhoneAuth] verifyPhoneNumber failed \\(error.localizedDescription)")
                    self.pluginImplementation.handlePhoneVerificationFailed(error)
                } else {
                    CAPLog.print("[PhoneAuth] Verification ID Received")
                    self.pluginImplementation.handlePhoneCodeSent(verificationID ?? "")
                }
            }
    }`,
      );
      fs.writeFileSync(handlerPath, handler);
    }
  }

  return next;
}

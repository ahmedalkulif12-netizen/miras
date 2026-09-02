import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

/**
 * Miras Capacitor config — Android + iOS.
 * webDir must match Vite `dist` output from `npm run build`.
 *
 * Branding:
 * - Web UI uses `BrandLogo` (`miras-badge.png` + مَرَاس / Miras wordmark).
 * - Native splash drawable name remains `splash` (androidSplashResourceName).
 *   Replace android/ios splash & launcher assets from miras-badge.png when shipping.
 */
const config: CapacitorConfig = {
  // Android applicationId stays com.miras.app in Gradle.
  // iOS App Store / TestFlight bundle ID is com.ahmed.miras (Xcode project).
  appId: 'com.miras.app',
  appName: 'مَرَاس',
  webDir: 'dist',
  // Serve the SPA from the local Capacitor host (bundled assets).
  server: {
    androidScheme: 'https',
    // iOS forbids http/https/file as iosScheme — capacitor:// is required.
    iosScheme: 'capacitor',
    // Same host as Firebase Auth authorized domains / Phone Auth reCAPTCHA.
    hostname: 'hamula-cfc6c.web.app',
    // Never list this app's own hostname here — Capacitor will then load the
    // remote Hosting site instead of ios/App/App/public and TestFlight shows white.
    allowNavigation: [
      'https://*.googleapis.com',
      'https://*.firebaseapp.com',
      'https://*.firebaseio.com',
      'https://*.cloudfunctions.net',
      'https://*.run.app',
      'https://api.moyasar.com',
      'https://*.moyasar.com',
      'https://*.google.com',
      'https://*.gstatic.com',
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#F8F9FB',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#F8F9FB',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true,
    },
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#F8F9FB',
    webContentsDebuggingEnabled: false,
  },
  ios: {
    backgroundColor: '#F8F9FB',
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scrollEnabled: true,
    allowsLinkPreview: false,
  },
  // SPM derives identity from the last path component. The Capacitor Firebase
  // plugin lives in node_modules/.../app-check, which collides with Google's
  // AppCheckCore package pulled in by firebase-ios-sdk. CLI 8.4+ can symlink
  // the plugin to CapApp-SPM/symlinks/CapacitorFirebaseAppCheck instead.
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          '@capacitor-firebase/app-check': { symlink: true },
        },
      },
    },
  },
};

export default config;

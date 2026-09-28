import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

/**
 * JZ Logistics Capacitor config — Android + iOS.
 * webDir must match Vite `dist` output from `npm run build`.
 *
 * Branding:
 * - Display name is JZ Logistics. Launcher art comes from app_icon.png
 *   (fallback: src/components/jz-logo.svg) via scripts/generate-native-assets.mjs.
 * - Native splash drawable name remains `splash` (androidSplashResourceName).
 */
const config: CapacitorConfig = {
  // Registered store / Firebase identities. Do not rename without new
  // google-services.json, GoogleService-Info.plist, and store listings.
  // Android applicationId: com.miras.app. iOS bundle ID: com.ahmed.miras.
  appId: 'com.miras.app',
  appName: 'JZ Logistics',
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
      'https://*.recaptcha.net',
      'https://www.recaptcha.net',
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#000000',
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
    FirebaseAuthentication: {
      // JS Firebase Auth remains the session source (Firestore, ID tokens).
      // Native Capacitor only verifies the phone number so SMS is not blocked by WebView reCAPTCHA.
      skipNativeAuth: true,
      providers: ['phone'],
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
  // the plugin; scripts/fix-ios-spm-app-check.mjs then replaces that symlink
  // with a real CapApp-SPM/packages/CapacitorFirebaseAppCheck copy so archive
  // does not realpath() back to identity `app-check`.
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          '@capacitor-firebase/app-check': { symlink: true },
          '@capacitor-firebase/authentication': { symlink: true },
        },
      },
    },
  },
};

export default config;

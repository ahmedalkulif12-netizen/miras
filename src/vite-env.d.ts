/// <reference types="vite/client" />

/**
 * Vite exposes ONLY variables prefixed with VITE_ to the client bundle.
 * Server secrets must never use the VITE_ prefix.
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_GOOGLE_MAPS_PLATFORM_KEY?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_APP_CHECK_DEBUG_TOKEN?: string;
  readonly VITE_APP_CHECK_RECAPTCHA_SITE_KEY?: string;
  readonly VITE_APP_CHECK_DISABLED?: string;
  /** When true in Vite DEV: skip real reCAPTCHA (Console test phone numbers only). */
  readonly VITE_PHONE_AUTH_TESTING?: string;
  /** Opt-in localhost mock auth (never for production). */
  readonly VITE_ENABLE_DEV_AUTH_BYPASS?: string;
  readonly VITE_MIRAS_DEPLOY_ENV?: 'development' | 'staging' | 'production';
  /** @deprecated Use VITE_MIRAS_DEPLOY_ENV */
  readonly VITE_HAMOULA_DEPLOY_ENV?: 'development' | 'staging' | 'production';
  /** Optional public HTTPS app origin for Moyasar callbacks (native must not use localhost). */
  readonly VITE_APP_URL?: string;
  /** Optional API origin when the SPA is hosted separately from Express (e.g. Firebase Hosting). */
  readonly VITE_API_ORIGIN?: string;
  /** Apple Developer Team ID for Universal Links (apple-app-site-association). */
  readonly VITE_IOS_TEAM_ID?: string;
  /** Comma-separated SHA-256 cert fingerprints for Android App Links (assetlinks.json). */
  readonly VITE_ANDROID_SHA256_CERT_FINGERPRINTS?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_CORPORATE_EMAIL?: string;
  readonly VITE_SUPPORT_PHONE_DISPLAY?: string;
  readonly VITE_SUPPORT_PHONE_TEL?: string;
  readonly VITE_SUPPORT_WHATSAPP?: string;
  readonly VITE_SUPPORT_WHATSAPP_DISPLAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

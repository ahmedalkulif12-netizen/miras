import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { buildAppleAppSiteAssociation, buildDigitalAssetLinks, parseAndroidSha256Fingerprints, readAppleTeamId } from './scripts/appleTeamId.mjs';

/** Emit Digital Asset Links / AASA from env so store App Links verify. */
function appLinksWellKnownPlugin(mode: string, env: Record<string, string>): Plugin {
  const merged = { ...process.env, ...env };
  const fingerprints = parseAndroidSha256Fingerprints(merged);
  const teamId = readAppleTeamId(merged);
  if (mode !== 'development' && !teamId) {
    console.warn(
      '[app-links] VITE_IOS_TEAM_ID is missing. Hosted apple-app-site-association will not verify Universal Links. Run: node scripts/set-ios-team-id.mjs YOURTEAMID'
    );
  }
  if (mode !== 'development' && fingerprints.length === 0) {
    console.warn(
      '[app-links] VITE_ANDROID_SHA256_CERT_FINGERPRINTS is empty. Hosted assetlinks.json will not verify Android App Links until Play App Signing SHA-256 is set in miras_client.'
    );
  }

  const assetLinks = `${JSON.stringify(buildDigitalAssetLinks(fingerprints), null, 2)}\n`;
  const aasa = teamId ? `${JSON.stringify(buildAppleAppSiteAssociation(teamId), null, 2)}\n` : '';

  return {
    name: 'app-links-well-known',
    generateBundle() {
      if (mode === 'development') return;
      if (fingerprints.length) {
        this.emitFile({
          type: 'asset',
          fileName: '.well-known/assetlinks.json',
          source: assetLinks,
        });
      }
      if (aasa) {
        this.emitFile({
          type: 'asset',
          fileName: '.well-known/apple-app-site-association',
          source: aasa,
        });
        this.emitFile({
          type: 'asset',
          fileName: 'apple-app-site-association',
          source: aasa,
        });
      }
    },
  };
}

/** Runs before any ES module — clears App Check debug globals on production builds. */
function appCheckProductionHtmlGuard(): Plugin {
  return {
    name: 'app-check-production-html-guard',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.server) {
          return html;
        }
        const guardScript = `<script>(function(){try{var g=typeof globalThis!=="undefined"?globalThis:typeof self!=="undefined"?self:window;if(!g)return;try{delete g.FIREBASE_APPCHECK_DEBUG_TOKEN}catch(e){g.FIREBASE_APPCHECK_DEBUG_TOKEN=void 0}try{Object.defineProperty(g,"FIREBASE_APPCHECK_DEBUG_TOKEN",{configurable:!0,enumerable:!1,get:function(){return void 0},set:function(){}})}catch(e){}}catch(e){}})();</script>`;
        return html.replace('<head>', `<head>\n    ${guardScript}`);
      },
    },
  };
}

/** Fail CI/store builds instead of shipping a binary that crashes on missing Firebase config. */
function requireClientEnvPlugin(mode: string, env: Record<string, string>): Plugin {
  return {
    name: 'require-client-env',
    configResolved() {
      if (mode === 'development') return;
      const merged = { ...env, ...process.env };
      const required = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_APP_ID',
        'VITE_FIREBASE_MESSAGING_SENDER_ID',
      ];
      const missing = required.filter((key) => !String(merged[key] || '').trim());
      if (missing.length) {
        throw new Error(
          `[vite] Missing required client env for ${mode} build: ${missing.join(', ')}. ` +
            'Set them in Codemagic group miras_client or in .env / .env.production.'
        );
      }
      const deploy = String(merged.VITE_MIRAS_DEPLOY_ENV || merged.VITE_HAMOULA_DEPLOY_ENV || '').trim();
      if (deploy === 'production' && String(merged.VITE_APP_CHECK_DISABLED || '') === 'true') {
        throw new Error('[vite] VITE_APP_CHECK_DISABLED=true is forbidden when VITE_MIRAS_DEPLOY_ENV=production.');
      }
      const requireAppLinks = String(merged.MIRAS_REQUIRE_APP_LINKS || '').trim() === 'true';
      if (requireAppLinks && parseAndroidSha256Fingerprints(merged).length === 0) {
        throw new Error(
          '[vite] VITE_ANDROID_SHA256_CERT_FINGERPRINTS is required for Android App Links / Hosting DAL. Set the Play App Signing SHA-256 in miras_client.'
        );
      }
    },
  };
}

function isCapacitorWebBuild(): boolean {
  const flag = process.env.CAPACITOR_BUILD?.trim();
  if (flag === '1' || flag === 'true') return true;
  const script = process.env.npm_lifecycle_event || '';
  return script.startsWith('cap:sync') || script.startsWith('cap:run');
}

// P0-15: Client receives ONLY import.meta.env.VITE_* at build time.
// Do not use `define` to inject server secrets (Moyasar, webhook, service accounts).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const capacitorBuild = isCapacitorWebBuild();
  if (capacitorBuild) {
    console.info('[vite] Capacitor build: base="./" so iOS WKWebView can load bundled assets');
  }
  return {
    // Absolute "/assets/…" URLs 404 inside capacitor:// WKWebView → blank white screen.
    // Firebase Hosting keeps base "/" so deep links like /login still resolve /assets.
    base: capacitorBuild ? './' : '/',
    plugins: [
      requireClientEnvPlugin(mode, env),
      appCheckProductionHtmlGuard(),
      appLinksWellKnownPlugin(mode, env),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'firebase';
            }
            if (id.includes('node_modules/@vis.gl') || id.includes('node_modules/@googlemaps')) {
              return 'maps';
            }
            if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
              return 'i18n';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'icons';
            }
            return undefined;
          },
        },
      },
    },
    // Production bundles must never embed App Check debug tokens (even if CI copies .env).
    define:
      mode === 'production'
        ? {
            'import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN': 'undefined',
          }
        : undefined,
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/.wa-auth/**'],
      },
    },
    optimizeDeps: {
      exclude: ['@langchain/langgraph', '@langchain/core'],
    },
  };
});

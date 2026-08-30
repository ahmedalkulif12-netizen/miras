import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { buildAppleAppSiteAssociation, readAppleTeamId } from './scripts/appleTeamId.mjs';

/** Emit Digital Asset Links / AASA from env so store App Links verify. */
function appLinksWellKnownPlugin(mode: string, env: Record<string, string>): Plugin {
  const merged = { ...process.env, ...env };
  const fingerprints = (
    merged.VITE_ANDROID_SHA256_CERT_FINGERPRINTS ||
    merged.ANDROID_SHA256_CERT_FINGERPRINTS ||
    ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const teamId = readAppleTeamId(merged);
  if (mode !== 'development' && !teamId) {
    console.warn(
      '[app-links] VITE_IOS_TEAM_ID is missing. Hosted apple-app-site-association will not verify Universal Links. Run: node scripts/set-ios-team-id.mjs YOURTEAMID'
    );
  }

  const assetLinks = JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.miras.app',
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    null,
    2
  );
  const aasa = teamId ? `${JSON.stringify(buildAppleAppSiteAssociation(teamId), null, 2)}\n` : '';

  return {
    name: 'app-links-well-known',
    generateBundle() {
      if (mode === 'development') return;
      this.emitFile({
        type: 'asset',
        fileName: '.well-known/assetlinks.json',
        source: assetLinks,
      });
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

// P0-15: Client receives ONLY import.meta.env.VITE_* at build time.
// Do not use `define` to inject server secrets (Moyasar, webhook, service accounts).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [appCheckProductionHtmlGuard(), appLinksWellKnownPlugin(mode, env), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
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

import React, { useLayoutEffect } from 'react';
import { AuthLoadingScreen } from '@/components/AppBootScreens';
import { resolveSmartQrRedirectUrl } from '@/lib/smartQrRedirect';

/**
 * Client fallback when Firebase Hosting still serves the SPA for /qr.
 * Production 302s are issued by Express (server.ts) after Hosting rewrites.
 */
const SmartQrRedirectPage: React.FC = () => {
  useLayoutEffect(() => {
    const target = resolveSmartQrRedirectUrl(
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
      { appUrl: typeof window !== 'undefined' ? window.location.origin : undefined }
    );
    window.location.replace(target);
  }, []);

  return <AuthLoadingScreen />;
};

export default SmartQrRedirectPage;

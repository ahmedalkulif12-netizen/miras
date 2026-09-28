import React from 'react';
import { BrandLogo } from '@/components/BrandLogo';

export const AuthLoadingScreen: React.FC = () => (
  <div className="flex items-center justify-center min-h-dvh bg-black">
    <div className="flex flex-col items-center gap-5">
      <BrandLogo size={72} withWordmark wordmarkBelow onDark />
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium text-[#FFCC00] animate-pulse">
        جاري التحميل... / Loading...
      </p>
    </div>
  </div>
);

export const BootstrapErrorScreen: React.FC<{ error?: unknown }> = ({ error }) => {
  const message = error instanceof Error ? error.message : error ? String(error) : '';
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000000',
        color: '#FFCC00',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <div>
        <p style={{ fontWeight: 800, fontSize: 20, marginBottom: 8, color: '#FFCC00' }}>JZ Logistics</p>
        <p style={{ color: '#FFCC00', marginBottom: 12 }}>تعذر تشغيل التطبيق / App failed to start</p>
        {message ? (
          <p style={{ color: '#F5F5F5', fontSize: 13, maxWidth: 360, margin: '0 auto' }}>{message}</p>
        ) : null}
      </div>
    </div>
  );
};

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n';
import { bootstrapNativeShell, hideNativeSplash } from '@/lib/nativeShell';
import { AuthLoadingScreen, BootstrapErrorScreen } from '@/components/AppBootScreens';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

const root = createRoot(rootElement);

function showFatal(error: unknown): void {
  console.error('[app] uncaught exception:', error);
  root.render(<BootstrapErrorScreen error={error} />);
  void hideNativeSplash();
}

window.addEventListener('error', (event) => {
  if (event.error) showFatal(event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[app] unhandled promise rejection:', event.reason);
});

async function bootstrap() {
  root.render(<AuthLoadingScreen />);

  try {
    await bootstrapNativeShell();

    const { ensureFirebaseReady } = await import('@/lib/firebase');
    try {
      await ensureFirebaseReady();
    } catch (error) {
      console.error('[Firebase] Bootstrap failed — App Check must succeed before Auth/Firestore:', error);
    }

    const { default: App } = await import('./App.tsx');
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  } catch (error) {
    console.error('[app] Native/web bootstrap failed:', error);
    root.render(<BootstrapErrorScreen error={error} />);
  } finally {
    await hideNativeSplash();
  }
}

void bootstrap();

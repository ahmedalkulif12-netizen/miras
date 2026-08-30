import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './i18n';
import { ensureFirebaseReady } from '@/lib/firebase';
import { bootstrapNativeShell } from '@/lib/nativeShell';
import { AuthLoadingScreen } from '@/components/AuthRouteGuards';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

const root = createRoot(rootElement);

async function bootstrap() {
  root.render(<AuthLoadingScreen />);

  await bootstrapNativeShell();

  try {
    await ensureFirebaseReady();
  } catch (error) {
    console.error('[Firebase] Bootstrap failed — App Check must succeed before Auth/Firestore:', error);
  }

  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();

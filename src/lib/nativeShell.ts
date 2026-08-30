/**
 * Capacitor native shell bootstrap — status bar, splash, Android back button.
 * Safe no-op on web.
 */
import { Capacitor } from '@capacitor/core';
import {
  nativeOpenUrlToSpaPath,
  shouldApplyNativeDeepLink,
} from '@/lib/appOrigin';

function applyNativeDeepLink(url: string): void {
  const path = nativeOpenUrlToSpaPath(url);
  if (!path || !shouldApplyNativeDeepLink(path)) return;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === path) {
    return;
  }
  window.location.assign(path);
}

export async function bootstrapNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  document.documentElement.classList.add('capacitor-native');
  document.documentElement.dataset.platform = Capacitor.getPlatform();

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#F8F9FB' });
    }
    await StatusBar.show();
  } catch (err) {
    console.warn('[native] StatusBar init skipped:', err);
  }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch (err) {
    console.warn('[native] SplashScreen hide skipped:', err);
  }

  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
  } catch {
    /* Keyboard plugin optional on some platforms */
  }

  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
        return;
      }
      void App.exitApp();
    });

    await App.addListener('appUrlOpen', ({ url }) => {
      try {
        applyNativeDeepLink(url);
      } catch (err) {
        console.warn('[native] appUrlOpen parse failed:', err);
      }
    });

    try {
      const launch = await App.getLaunchUrl();
      if (launch?.url) {
        applyNativeDeepLink(launch.url);
      }
    } catch {
      /* launch URL optional */
    }
  } catch (err) {
    console.warn('[native] App listeners skipped:', err);
  }
}
